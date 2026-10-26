
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";

import {
    DASHBOARD_ORIGIN,
} from "../src/security/requestOrigin";

type WorkerEnv = Parameters<typeof worker.fetch>[1];
type WorkerContext = Parameters<typeof worker.fetch>[2];

const testEnv = {
    ...env,
    ADMIN_API_ENABLED: "true",
    ADMIN_QUEUE_ENABLED: "true",
    MODERATOR_EMAILS: "admin@example.com",
} as WorkerEnv;

const adminContext = {
    access: {
        getIdentity: async () => ({
            email: "admin@example.com",
        }),
    },
} as unknown as WorkerContext;

const anonymousContext = {} as WorkerContext;

function reviewUrl(
    id: string,
    action: "approve" | "reject"
): string {
    return (
        `http://localhost/api/admin/incidents/` +
        `${id}/${action}`
    );
}

async function sendReview(
    id: string,
    action: "approve" | "reject",
    context: WorkerContext = adminContext,
    environment: WorkerEnv = testEnv,
    headers?: HeadersInit
): Promise<Response> {
    const requestHeaders = new Headers({
        Origin: DASHBOARD_ORIGIN,
    });

    if (headers) {
        new Headers(headers).forEach((value, name) => {
            requestHeaders.set(name, value);
        });
    }

    return worker.fetch(
        new Request(reviewUrl(id, action), {
            method: "POST",
            headers: requestHeaders,
        }),
        environment,
        context
    );
}

async function sendPreflight(
    id: string,
    action: "approve" | "reject",
    origin: string,
    requestedMethod = "POST",
    requestedHeaders = "content-type"
): Promise<Response> {
    return worker.fetch(
        new Request(reviewUrl(id, action), {
            method: "OPTIONS",
            headers: {
                Origin: origin,
                "Access-Control-Request-Method":
                requestedMethod,
                "Access-Control-Request-Headers":
                requestedHeaders,
            },
        }),
        testEnv,
        anonymousContext
    );
}

async function createTestIncident(): Promise<string> {
    const id = crypto.randomUUID();

    await testEnv.DB.prepare(
        `INSERT INTO incidents (id, story, status)
         VALUES (?, ?, 'pending')`
    )
        .bind(
            id,
            "The roboRIO threw an exception during finals."
        )
        .run();

    return id;
}

interface IncidentRow {
    id: string;
    status: string;
    reviewed_at: string | null;
    published_at: string | null;
}

async function getIncident(
    id: string
): Promise<IncidentRow | null> {
    return testEnv.DB.prepare(
        `SELECT id, status, reviewed_at, published_at
         FROM incidents
         WHERE id = ?`
    )
        .bind(id)
        .first<IncidentRow>();
}

interface AuditRow {
    id: string;
    incident_id: string;
    moderator_email: string;
    action: string;
    previous_status: string;
    new_status: string;
    created_at: string;
}

async function getAuditRows(
    incidentId: string
): Promise<AuditRow[]> {
    const result = await testEnv.DB.prepare(
        `SELECT
            id,
            incident_id,
            moderator_email,
            action,
            previous_status,
            new_status,
            created_at
         FROM moderation_audit
         WHERE incident_id = ?`
    )
        .bind(incidentId)
        .all<AuditRow>();

    return result.results;
}

async function deleteTestIncident(
    id: string
): Promise<void> {
    await testEnv.DB.prepare(
        `DELETE FROM moderation_audit
         WHERE incident_id = ?`
    )
        .bind(id)
        .run();

    await testEnv.DB.prepare(
        `DELETE FROM incidents WHERE id = ?`
    )
        .bind(id)
        .run();
}

describe("Trauma Center incident review", () => {
    it("approves and audits a pending incident", async () => {
        const id = await createTestIncident();

        try {
            const response = await sendReview(
                id, "approve"
            );

            expect(response.status).toBe(200);

            const incident = await getIncident(id);

            expect(incident?.status).toBe("approved");
            expect(incident?.reviewed_at).not.toBeNull();
            expect(incident?.published_at).not.toBeNull();

            const audit = await getAuditRows(id);

            expect(audit).toHaveLength(1);
            expect(audit[0].incident_id).toBe(id);
            expect(audit[0].moderator_email)
                .toBe("admin@example.com");
            expect(audit[0].action).toBe("approved");
            expect(audit[0].previous_status)
                .toBe("pending");
            expect(audit[0].new_status)
                .toBe("approved");
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("rejects and audits a pending incident", async () => {
        const id = await createTestIncident();

        try {
            const response = await sendReview(
                id, "reject"
            );

            expect(response.status).toBe(200);

            const incident = await getIncident(id);

            expect(incident?.status).toBe("rejected");
            expect(incident?.reviewed_at).not.toBeNull();
            expect(incident?.published_at).toBeNull();

            const audit = await getAuditRows(id);

            expect(audit).toHaveLength(1);
            expect(audit[0].action).toBe("rejected");
            expect(audit[0].new_status)
                .toBe("rejected");
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("prevents reviewing an incident twice", async () => {
        const id = await createTestIncident();

        try {
            const first = await sendReview(
                id, "approve"
            );

            expect(first.status).toBe(200);

            const second = await sendReview(
                id, "reject"
            );

            expect(second.status).toBe(409);
            expect(await second.json()).toEqual({
                error: "ALREADY_REVIEWED",
            });

            const incident = await getIncident(id);
            const audit = await getAuditRows(id);

            expect(incident?.status).toBe("approved");
            expect(audit).toHaveLength(1);
            expect(audit[0].action).toBe("approved");
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("handles concurrent review attempts", async () => {
        const id = await createTestIncident();

        try {
            const responses = await Promise.all([
                sendReview(id, "approve"),
                sendReview(id, "reject"),
            ]);

            const statuses = responses
                .map((response) => response.status)
                .sort();

            expect(statuses).toEqual([200, 409]);

            const audit = await getAuditRows(id);
            const incident = await getIncident(id);

            expect(audit).toHaveLength(1);
            expect(audit[0].new_status)
                .toBe(incident?.status);
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("rolls back when audit insertion fails", async () => {
        const id = await createTestIncident();

        await testEnv.DB.prepare(
            `CREATE TRIGGER test_audit_failure
             BEFORE INSERT ON moderation_audit
             WHEN NEW.incident_id = '${id}'
             BEGIN
                 SELECT RAISE(
                     ABORT,
                     'Simulated audit failure'
                 );
             END`
        ).run();

        try {
            const response = await sendReview(
                id, "approve"
            );

            expect(response.status).toBe(503);

            const incident = await getIncident(id);
            const audit = await getAuditRows(id);

            expect(incident?.status).toBe("pending");
            expect(incident?.reviewed_at).toBeNull();
            expect(incident?.published_at).toBeNull();
            expect(audit).toHaveLength(0);
        } finally {
            await testEnv.DB.prepare(
                "DROP TRIGGER IF EXISTS test_audit_failure"
            ).run();

            await deleteTestIncident(id);
        }
    });

    it("returns 404 for a nonexistent incident", async () => {
        const id = crypto.randomUUID();

        const response = await sendReview(
            id, "approve"
        );

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({
            error: "INCIDENT_NOT_FOUND",
        });

        expect(await getAuditRows(id))
            .toHaveLength(0);
    });

    it("rejects malformed incident IDs", async () => {
        const response = await sendReview(
            "not-a-uuid", "approve"
        );

        expect(response.status).toBe(400);
    });

    it("rejects anonymous review attempts", async () => {
        const id = await createTestIncident();

        try {
            const response = await sendReview(
                id,
                "approve",
                anonymousContext
            );

            expect(response.status).toBe(401);

            expect((await getIncident(id))?.status)
                .toBe("pending");

            expect(await getAuditRows(id))
                .toHaveLength(0);
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("blocks review operations when disabled", async () => {
        const id = await createTestIncident();

        try {
            const disabledEnv = {
                ...testEnv,
                ADMIN_API_ENABLED: "false",
            } as WorkerEnv;

            const response = await sendReview(
                id,
                "approve",
                adminContext,
                disabledEnv
            );

            expect(response.status).toBe(503);

            expect((await getIncident(id))?.status)
                .toBe("pending");

            expect(await getAuditRows(id))
                .toHaveLength(0);
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("does not trust forged moderator headers", async () => {
        const id = await createTestIncident();

        try {
            const response = await sendReview(
                id,
                "approve",
                anonymousContext,
                testEnv,
                {
                    "CF-Access-Authenticated-User-Email":
                        "admin@example.com",
                }
            );

            expect(response.status).toBe(401);

            expect((await getIncident(id))?.status)
                .toBe("pending");

            expect(await getAuditRows(id))
                .toHaveLength(0);
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("blocks reviews from foreign origins", async () => {
        const id = await createTestIncident();

        try {
            const response = await sendReview(
                id,
                "approve",
                adminContext,
                testEnv,
                {
                    Origin: "https://evil.example",
                }
            );

            expect(response.status).toBe(403);
            expect(await response.json()).toEqual({
                error: "UNTRUSTED_ORIGIN",
            });

            expect((await getIncident(id))?.status)
                .toBe("pending");

            expect(await getAuditRows(id))
                .toHaveLength(0);
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("does not accept spoofed domain suffixes", async () => {
        const id = await createTestIncident();

        try {
            const response = await sendReview(
                id,
                "reject",
                adminContext,
                testEnv,
                {
                    Origin:
                        "https://admin.finallynomoreroborio.party.evil.example",
                }
            );

            expect(response.status).toBe(403);

            expect((await getIncident(id))?.status)
                .toBe("pending");

            expect(await getAuditRows(id))
                .toHaveLength(0);
        } finally {
            await deleteTestIncident(id);
        }
    });

    it("returns CORS headers for trusted requests", async () => {
        const response = await sendReview(
            "not-a-uuid", "approve"
        );

        expect(response.status).toBe(400);

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
    });

    it("accepts a trusted browser preflight", async () => {
        const response = await sendPreflight(
            crypto.randomUUID(),
            "approve",
            DASHBOARD_ORIGIN
        );

        expect(response.status).toBe(204);

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
    });

    it("rejects a foreign browser preflight", async () => {
        const response = await sendPreflight(
            crypto.randomUUID(),
            "reject",
            "https://evil.example"
        );

        expect(response.status).toBe(403);

        expect(
            response.headers.get(
                "Access-Control-Allow-Origin"
            )
        ).toBeNull();
    });
});
