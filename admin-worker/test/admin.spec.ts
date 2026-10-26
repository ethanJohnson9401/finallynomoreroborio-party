
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";

type WorkerEnv = Parameters<typeof worker.fetch>[1];
type WorkerContext = Parameters<typeof worker.fetch>[2];

const BASE_URL = "http://localhost";
const ADMIN_URL = `${BASE_URL}/api/admin/incidents`;

const adminEnv = {
    ...env,
    ADMIN_API_ENABLED: "true",
    MODERATOR_EMAILS: "admin@example.com",
} as WorkerEnv;

/**
 * Simulates an identity that Cloudflare Access
 * has already authenticated.
 *
 * Only used inside the test runtime.
 */
function accessContext(
    email?: string
): WorkerContext {
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
        new Request(ADMIN_URL, { headers }),
        environment,
        context
    );
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

    it("rejects anonymous requests", async () => {
        const response = await requestAdmin(
            anonymousContext()
        );

        expect(response.status).toBe(401);
    });

    it("rejects identities outside the moderator allowlist", async () => {
        const response = await requestAdmin(
            accessContext("visitor@example.com")
        );

        expect(response.status).toBe(403);
    });

    it("allows moderators to read pending incidents", async () => {
        const id = crypto.randomUUID();

        const story =
            "Our roboRIO decided autonomous was optional during finals.";

        // Insert into isolated test D1 storage.
        await adminEnv.DB.prepare(
            `INSERT INTO incidents (id, story, status)
             VALUES (?, ?, 'pending')`
        )
            .bind(id, story)
            .run();

        try {
            const response = await requestAdmin(
                accessContext("admin@example.com")
            );

            expect(response.status).toBe(200);

            const body = await response.text();

            expect(body).toContain(id);
            expect(body).toContain(story);
            expect(body).toContain("pending");
        } finally {
            await adminEnv.DB.prepare(
                "DELETE FROM incidents WHERE id = ?"
            )
                .bind(id)
                .run();
        }
    });

    it("blocks access when the admin API is disabled", async () => {
        const disabledEnv = {
            ...adminEnv,
            ADMIN_API_ENABLED: "false",
        } as WorkerEnv;

        const response = await requestAdmin(
            accessContext("admin@example.com"),
            disabledEnv
        );

        expect(response.status).toBe(503);
        expect(await response.text()).toContain(
            "ADMIN_API_DISABLED"
        );
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

    it("rejects access with an empty moderator allowlist", async () => {
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

    it("rejects Access contexts without a verified email", async () => {
        const response = await requestAdmin(
            accessContext()
        );

        expect(response.status).toBe(401);
    });
});
