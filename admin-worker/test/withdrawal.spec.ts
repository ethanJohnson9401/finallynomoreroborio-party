
import {
    describe,
    expect,
    it,
} from "vitest";

import { env } from "cloudflare:workers";
import worker from "../src/index";

import {
    DASHBOARD_ORIGIN,
} from "../src/security/requestOrigin";

type WorkerEnv = Parameters<typeof worker.fetch>[1];
type WorkerContext = Parameters<typeof worker.fetch>[2];

const BASE_URL = "http://localhost/api/admin/incidents";

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

const REASON =
    "Removed following a privacy-related report.";

function requestWithdrawal(
    id: string,
    reason: unknown = REASON,
    context: WorkerContext = adminContext,
    environment: WorkerEnv = testEnv,
    origin = DASHBOARD_ORIGIN
): Promise<Response> {
    return worker.fetch(
        new Request(
            `${BASE_URL}/${id}/withdraw`,
            {
                method: "POST",
                headers: {
                    Origin: origin,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ reason }),
            }
        ),
        environment,
        context
    );
}

async function createIncident(
    status: "pending" | "approved" | "rejected"
): Promise<string> {
    const id = crypto.randomUUID();

    await testEnv.DB
        .prepare(
            `INSERT INTO incidents (
                id, story, status, published_at
            )
            VALUES (
                ?, ?, ?,
                CASE WHEN ? = 'approved'
                    THEN CURRENT_TIMESTAMP
                    ELSE NULL
                END
            )`
        )
        .bind(
            id,
            "Our roboRIO unexpectedly lost communications during finals.",
            status,
            status
        )
        .run();

    return id;
}

async function readIncident(id: string) {
    return testEnv.DB
        .prepare(
            `SELECT
                status,
                published_at,
                withdrawn_at
             FROM incidents
             WHERE id = ?`
        )
        .bind(id)
        .first<{
            status: string;
            published_at: string | null;
            withdrawn_at: string | null;
        }>();
}

async function readAudit(id: string) {
    const result = await testEnv.DB
        .prepare(
            `SELECT
                moderator_email,
                reason
             FROM incident_withdrawal_audit
             WHERE incident_id = ?`
        )
        .bind(id)
        .all<{
            moderator_email: string;
            reason: string;
        }>();

    return result.results;
}

async function cleanup(id: string) {
    await testEnv.DB
        .prepare(
            `DELETE FROM incident_withdrawal_audit
             WHERE incident_id = ?`
        )
        .bind(id)
        .run();

    await testEnv.DB
        .prepare(
            `DELETE FROM moderation_audit
             WHERE incident_id = ?`
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

describe("Incident withdrawal security", () => {
    it("withdraws an approved report and creates an audit record", async () => {
        const id = await createIncident("approved");

        try {
            const response =
                await requestWithdrawal(id);

            expect(response.status).toBe(200);

            const incident =
                await readIncident(id);

            expect(incident?.status)
                .toBe("approved");

            expect(incident?.published_at)
                .toBeNull();

            expect(incident?.withdrawn_at)
                .not.toBeNull();

            const audit = await readAudit(id);

            expect(audit).toHaveLength(1);
            expect(audit[0]).toEqual({
                moderator_email: "admin@example.com",
                reason: REASON,
            });
        } finally {
            await cleanup(id);
        }
    });

    it.each(["pending", "rejected"] as const)(
        "rejects withdrawal of %s incidents",
        async (status) => {
            const id = await createIncident(status);

            try {
                const response =
                    await requestWithdrawal(id);

                expect(response.status).toBe(409);
                expect(await readAudit(id))
                    .toHaveLength(0);
            } finally {
                await cleanup(id);
            }
        }
    );

    it("rejects a second withdrawal", async () => {
        const id = await createIncident("approved");

        try {
            const first =
                await requestWithdrawal(id);

            const second =
                await requestWithdrawal(id);

            expect(first.status).toBe(200);
            expect(second.status).toBe(409);
            expect(await readAudit(id))
                .toHaveLength(1);
        } finally {
            await cleanup(id);
        }
    });

    it("rejects unauthenticated withdrawal", async () => {
        const id = await createIncident("approved");

        try {
            const response = await requestWithdrawal(
                id,
                REASON,
                anonymousContext
            );

            expect(response.status).toBe(401);

            const incident = await readIncident(id);

            expect(incident?.withdrawn_at)
                .toBeNull();

            expect(await readAudit(id))
                .toHaveLength(0);
        } finally {
            await cleanup(id);
        }
    });

    it("rejects a moderator outside the allowlist", async () => {
        const id = await createIncident("approved");

        const visitorContext = {
            access: {
                getIdentity: async () => ({
                    email: "visitor@example.com",
                }),
            },
        } as unknown as WorkerContext;

        try {
            const response = await requestWithdrawal(
                id,
                REASON,
                visitorContext
            );

            expect(response.status).toBe(403);
            expect(await readAudit(id))
                .toHaveLength(0);
        } finally {
            await cleanup(id);
        }
    });

    it("blocks requests from untrusted origins", async () => {
        const id = await createIncident("approved");

        try {
            const response = await requestWithdrawal(
                id,
                REASON,
                adminContext,
                testEnv,
                "https://attacker.example"
            );

            expect(response.status).toBe(403);
            expect(await readAudit(id))
                .toHaveLength(0);
        } finally {
            await cleanup(id);
        }
    });

    it("rejects invalid withdrawal reasons", async () => {
        const id = await createIncident("approved");

        try {
            for (const reason of [
                "",
                "Too short",
                "x".repeat(501),
                123,
                null,
            ]) {
                const response = await requestWithdrawal(
                    id,
                    reason
                );

                expect(response.status).toBe(400);
            }

            expect(await readAudit(id))
                .toHaveLength(0);
        } finally {
            await cleanup(id);
        }
    });

    it("respects the moderation write kill switch", async () => {
        const id = await createIncident("approved");

        const disabledEnv = {
            ...testEnv,
            ADMIN_API_ENABLED: "false",
        } as WorkerEnv;

        try {
            const response = await requestWithdrawal(
                id,
                REASON,
                adminContext,
                disabledEnv
            );

            expect(response.status).toBe(503);
            expect(await readAudit(id))
                .toHaveLength(0);
        } finally {
            await cleanup(id);
        }
    });

    it("prevents concurrent double withdrawal", async () => {
        const id = await createIncident("approved");

        try {
            const responses = await Promise.all([
                requestWithdrawal(id),
                requestWithdrawal(id),
            ]);

            const statuses = responses
                .map((response) => response.status)
                .sort((a, b) => a - b);

            expect(statuses).toEqual([200, 409]);
            expect(await readAudit(id))
                .toHaveLength(1);
        } finally {
            await cleanup(id);
        }
    });

    it("rolls back withdrawal if audit insertion fails", async () => {
        const id = await createIncident("approved");

        const triggerName =
            "test_withdrawal_audit_failure";

        await testEnv.DB
            .prepare(
                `CREATE TRIGGER ${triggerName}
                 BEFORE INSERT ON incident_withdrawal_audit
                 WHEN NEW.incident_id = '${id}'
                 BEGIN
                    SELECT RAISE(
                        ABORT,
                        'Simulated withdrawal audit failure'
                    );
                 END`
            )
            .run();

        try {
            const response = await requestWithdrawal(id);

            expect(response.status).toBe(503);

            const incident = await readIncident(id);

            expect(incident?.withdrawn_at)
                .toBeNull();

            expect(incident?.published_at)
                .not.toBeNull();

            expect(await readAudit(id))
                .toHaveLength(0);
        } finally {
            await testEnv.DB
                .prepare(
                    `DROP TRIGGER IF EXISTS ${triggerName}`
                )
                .run();

            await cleanup(id);
        }
    });
});
