
/**
 * Private Trauma Center database operations.
 *
 * Pending reports must never be exposed through
 * the public Worker.
 */

export interface PendingIncident {
    id: string;
    story: string;
    status: "pending";
    created_at: string;
}

export async function getPendingIncidents(
    db: D1Database,
    limit = 50
): Promise<PendingIncident[]> {
    const safeLimit = Math.max(
        1,
        Math.min(100, Math.trunc(limit))
    );

    const result = await db
        .prepare(
            `SELECT id, story, status, created_at
             FROM incidents
             WHERE status = 'pending'
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
        )
        .bind(safeLimit)
        .all<PendingIncident>();

    if (!result.success) {
        throw new Error(
            "Failed to retrieve pending incidents"
        );
    }

    return result.results;
}
