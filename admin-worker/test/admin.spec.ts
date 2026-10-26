
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";

import {
    DASHBOARD_ORIGIN,
} from "../src/security/requestOrigin";

type WorkerEnv = Parameters<typeof worker.fetch>[1];
type WorkerContext = Parameters<typeof worker.fetch>[2];

const BASE_URL = "http://localhost";
const QUEUE_URL = `${BASE_URL}/api/admin/incidents`;

const adminEnv = {
    ...env,
    ADMIN_API_ENABLED: "true",
    ADMIN_QUEUE_ENABLED: "true",
    MODERATOR_EMAILS: "admin@example.com",
} as WorkerEnv;

function accessContext(email?: string): WorkerContext {
    return {
        access: {
            getIdentity: async () =>
                email ? { email } : undefined,
        },
    } as unknown as WorkerContext;
}

function anonymousContext(): WorkerContext {
    return {} as WorkerContext;
}

async function requestAdmin(
    context: WorkerContext,
    environment: WorkerEnv = adminEnv,
    headers?: HeadersInit
): Promise<Response> {
    return worker.fetch(
        new Request(QUEUE_URL, {
            method: "GET",
            headers,
        }),
        environment,
        context
    );
}

async function createTestIncident(): Promise<{
    id: string;
    story: string;
}> {
    const id = crypto.randomUUID();
    const story =
        "Our roboRIO decided autonomous was optional during finals.";

    await adminEnv.DB.prepare(
        `INSERT INTO incidents (id, story, status)
         VALUES (?, ?, 'pending')`
    )
        .bind(id, story)
        .run();

    return { id, story };
}

async function deleteTestIncident(id: string): Promise<void> {
    await adminEnv.DB.prepare(
        "DELETE FROM moderation_audit WHERE incident_id = ?"
    )
        .bind(id)
        .run();

    await adminEnv.DB.prepare(
        "DELETE FROM incidents WHERE id = ?"
    )
        .bind(id)
        .run();
}

describe("roboRIO Trauma Center Admin API", () => {
    it("returns a successful health check", async () => {
        const response = await worker.fetch(
            new Request(`${BASE_URL}/api/health`),
            adminEnv,
            anonymousContext()
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            status: "ok",
            service: "roborio-trauma-admin-api",
        });
    });

    it("rejects anonymous queue requests", async () => {
        const response = await requestAdmin(
            anonymousContext()
        );

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
            error: "UNAUTHENTICATED",
        });
    });

    it("rejects non-moderator identities", async () => {
        const response = await requestAdmin(
            accessContext("visitor@example.com")
        );

        expect(response.status).toBe(403);
    });

    it("allows moderators to read pending incidents", async () => {
        const { id, story } = await createTestIncident();

        try {
            const response = await requestAdmin(
                accessContext("admin@example.com")
            );

            expect(response.status).toBe(200);

            const body = await response.json() as {
                status: string;
                incidents: Array<{
                    id: string;
                    story: string;
                    status: string;
                }>;
                count: number;
            };

            expect(body.status).toBe("ok");

            expect(body.incidents).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id,
                        story,
                        status: "pending",
                    }),
                ])
            );

            expect(body.count).toBeGreaterThanOrEqual(1);
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("blocks queue reads when disabled", async () => {
        const disabledEnv = {
            ...adminEnv,
            ADMIN_QUEUE_ENABLED: "false",
        } as WorkerEnv;

        const response = await requestAdmin(
            accessContext("admin@example.com"),
            disabledEnv
        );

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
            error: "ADMIN_QUEUE_DISABLED",
        });
    });

    it("allows queue reads while review mutations are disabled", async () => {
        const readOnlyEnv = {
            ...adminEnv,
            ADMIN_QUEUE_ENABLED: "true",
            ADMIN_API_ENABLED: "false",
        } as WorkerEnv;

        const response = await requestAdmin(
            accessContext("admin@example.com"),
            readOnlyEnv
        );

        expect(response.status).toBe(200);

        const body = await response.json() as {
            status: string;
            incidents: unknown[];
        };

        expect(body.status).toBe("ok");
        expect(Array.isArray(body.incidents)).toBe(true);
    });

    it("blocks review mutations when production write flag is disabled", async () => {
        const readOnlyEnv = {
            ...adminEnv,
            ADMIN_API_ENABLED: "false",
            ADMIN_QUEUE_ENABLED: "true",
        } as WorkerEnv;

        const id = crypto.randomUUID();

        const response = await worker.fetch(
            new Request(
                `${QUEUE_URL}/${id}/approve`,
                {
                    method: "POST",
                    headers: {
                        Origin: DASHBOARD_ORIGIN,
                    },
                }
            ),
            readOnlyEnv,
            accessContext("admin@example.com")
        );

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
            error: "ADMIN_API_DISABLED",
        });
    });

    it("does not trust forged identity headers", async () => {
        const response = await requestAdmin(
            anonymousContext(),
            adminEnv,
            {
                "CF-Access-Authenticated-User-Email":
                    "admin@example.com",
            }
        );

        expect(response.status).toBe(401);
    });

    it("rejects empty moderator allowlists", async () => {
        const noModeratorsEnv = {
            ...adminEnv,
            MODERATOR_EMAILS: "",
        } as WorkerEnv;

        const response = await requestAdmin(
            accessContext("admin@example.com"),
            noModeratorsEnv
        );

        expect(response.status).toBe(403);
    });

    it("rejects Access identities with no email", async () => {
        const response = await requestAdmin(
            accessContext()
        );

        expect(response.status).toBe(401);
    });

    it("allows credentialed CORS for the dashboard origin", async () => {
        const response = await requestAdmin(
            accessContext("admin@example.com"),
            adminEnv,
            { Origin: DASHBOARD_ORIGIN }
        );

        expect(response.status).toBe(200);

        expect(
            response.headers.get(
                "Access-Control-Allow-Origin"
            )
        ).toBe(DASHBOARD_ORIGIN);

        expect(
            response.headers.get(
                "Access-Control-Allow-Credentials"
            )
        ).toBe("true");

        expect(response.headers.get("Vary"))
            .toBe("Origin");
    });

    it("does not grant CORS to other origins", async () => {
        const response = await requestAdmin(
            accessContext("admin@example.com"),
            adminEnv,
            { Origin: "https://evil.example" }
        );

        expect(response.status).toBe(200);

        expect(
            response.headers.get(
                "Access-Control-Allow-Origin"
            )
        ).toBeNull();

        expect(
            response.headers.get(
                "Access-Control-Allow-Credentials"
            )
        ).toBeNull();
    });

    it("rejects POST requests to the queue endpoint", async () => {
        const response = await worker.fetch(
            new Request(QUEUE_URL, {
                method: "POST",
                headers: {
                    Origin: DASHBOARD_ORIGIN,
                },
            }),
            adminEnv,
            accessContext("admin@example.com")
        );

        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe("GET");

        expect(await response.json()).toEqual({
            error: "METHOD_NOT_ALLOWED",
        });
    });
});
