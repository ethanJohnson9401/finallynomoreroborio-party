
import {
    describe,
    expect,
    it,
} from "vitest";

import { env } from "cloudflare:workers";
import worker from "../src/index";

type WorkerEnv = Parameters<typeof worker.fetch>[1];
type WorkerContext = Parameters<typeof worker.fetch>[2];

const BASE_URL = "http://localhost/api/admin/incidents";

const testEnv = {
    ...env,
    ADMIN_API_ENABLED: "true",
    ADMIN_QUEUE_ENABLED: "true",
    MODERATOR_EMAILS: "admin@example.com",
} as WorkerEnv;

function identityContext(email: string): WorkerContext {
    return {
        access: {
            getIdentity: async () => ({ email }),
        },
    } as unknown as WorkerContext;
}

const moderator = identityContext("admin@example.com");
const visitor = identityContext("visitor@example.com");
const anonymous = {} as WorkerContext;

type IncidentStatus = "pending" | "approved" | "rejected";

async function createIncident(
    status: IncidentStatus,
    withdrawn = false
): Promise<string> {
    const id = crypto.randomUUID();

    await testEnv.DB
        .prepare(
            `INSERT INTO incidents (
                id,
                story,
                status,
                published_at,
                withdrawn_at
             )
             VALUES (
                ?, ?, ?,
                CASE
                    WHEN ? = 'approved' AND ? = 0
                    THEN CURRENT_TIMESTAMP
                    ELSE NULL
                END,
                CASE
                    WHEN ? = 1
                    THEN CURRENT_TIMESTAMP
                    ELSE NULL
                END
             )`
        )
        .bind(
            id,
            "The roboRIO disconnected during our championship match.",
            status,
            status,
            withdrawn ? 1 : 0,
            withdrawn ? 1 : 0
        )
        .run();

    return id;
}

async function cleanup(id: string) {
    await testEnv.DB
        .prepare(
            "DELETE FROM incident_withdrawal_audit WHERE incident_id = ?"
        )
        .bind(id)
        .run();

    await testEnv.DB
        .prepare(
            "DELETE FROM moderation_audit WHERE incident_id = ?"
        )
        .bind(id)
        .run();

    await testEnv.DB
        .prepare(
            "DELETE FROM incidents WHERE id = ?"
        )
        .bind(id)
        .run();
}

async function lookup(
    id: string,
    context: WorkerContext = moderator,
    environment: WorkerEnv = testEnv
): Promise<Response> {
    return worker.fetch(
        new Request(`${BASE_URL}/${id}`, {
            method: "GET",
        }),
        environment,
        context
    );
}

describe("Moderator incident lookup", () => {
    it.each([
        "pending",
        "approved",
        "rejected",
    ] as const)(
        "allows a moderator to retrieve a %s incident",
        async (status) => {
            const id = await createIncident(status);

            try {
                const response = await lookup(id);

                expect(response.status).toBe(200);

                const data = await response.json() as {
                    status: string;
                    incident: {
                        id: string;
                        story: string;
                        status: string;
                        published_at: string | null;
                        withdrawn_at: string | null;
                    };
                };

                expect(data.status).toBe("ok");
                expect(data.incident.id).toBe(id);
                expect(data.incident.status).toBe(status);
                expect(data.incident.story).toContain("roboRIO");

                if (status === "approved") {
                    expect(data.incident.published_at)
                        .not.toBeNull();
                } else {
                    expect(data.incident.published_at)
                        .toBeNull();
                }
            } finally {
                await cleanup(id);
            }
        }
    );

    it("returns withdrawn incidents to moderators", async () => {
        const id = await createIncident("approved", true);

        try {
            const response = await lookup(id);

            expect(response.status).toBe(200);

            const data = await response.json() as {
                incident: {
                    status: string;
                    published_at: string | null;
                    withdrawn_at: string | null;
                };
            };

            expect(data.incident.status).toBe("approved");
            expect(data.incident.published_at).toBeNull();
            expect(data.incident.withdrawn_at).not.toBeNull();
        } finally {
            await cleanup(id);
        }
    });

    it("rejects unauthenticated lookups", async () => {
        const id = await createIncident("pending");

        try {
            const response = await lookup(id, anonymous);

            expect(response.status).toBe(401);
            expect(await response.text()).not.toContain(
                "championship match"
            );
        } finally {
            await cleanup(id);
        }
    });

    it("rejects moderators outside the allowlist", async () => {
        const id = await createIncident("pending");

        try {
            const response = await lookup(id, visitor);

            expect(response.status).toBe(403);
            expect(await response.text()).not.toContain(
                "championship match"
            );
        } finally {
            await cleanup(id);
        }
    });

    it("rejects invalid receipt IDs", async () => {
        const response = await lookup("not-a-uuid");

        expect(response.status).toBe(400);

        const data = await response.json() as {
            error: string;
        };

        expect(data.error).toBe("INVALID_INCIDENT_ID");
    });

    it("returns 404 for unknown incidents", async () => {
        const response = await lookup(crypto.randomUUID());

        expect(response.status).toBe(404);

        const data = await response.json() as {
            error: string;
        };

        expect(data.error).toBe("INCIDENT_NOT_FOUND");
    });

    it("respects the queue safety switch", async () => {
        const disabledEnv = {
            ...testEnv,
            ADMIN_QUEUE_ENABLED: "false",
        } as WorkerEnv;

        const response = await lookup(
            crypto.randomUUID(),
            moderator,
            disabledEnv
        );

        expect(response.status).toBe(503);
    });

    it("rejects unsupported methods", async () => {
        const response = await worker.fetch(
            new Request(
                `${BASE_URL}/${crypto.randomUUID()}`,
                { method: "POST" }
            ),
            testEnv,
            moderator
        );

        expect(response.status).toBe(405);
    });
});
