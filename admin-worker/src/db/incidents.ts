
/**
 * Private roboRIO Trauma Center database operations.
 *
 * All review decisions must be audited atomically.
 */

export interface PendingIncident {
    id: string;
    story: string;
    status: "pending";
    created_at: string;
}

export type ReviewDecision = "approved" | "rejected";

export interface ReviewedIncident {
    id: string;
    status: ReviewDecision;
    reviewed_at: string;
    published_at: string | null;
}

export type ReviewResult =
    | {
    outcome: "reviewed";
    incident: ReviewedIncident;
}
    | {
    outcome: "not_found";
}
    | {
    outcome: "already_reviewed";
};

/**
 * Retrieve the pending incident queue.
 */
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

/**
 * Review exactly once and record the verified moderator.
 *
 * Both statements execute inside one D1 transaction.
 *
 * Statement 1 changes only pending incidents.
 *
 * Statement 2 creates an audit row only if Statement 1
 * changed exactly one incident. SQLite changes()
 * reflects the preceding UPDATE in this batch.
 *
 * If audit insertion fails, the entire batch rolls back.
 */
export async function reviewIncident(
    db: D1Database,
    id: string,
    decision: ReviewDecision,
    moderatorEmail: string
): Promise<ReviewResult> {
    const email = moderatorEmail.trim().toLowerCase();

    if (!email) {
        throw new Error("Verified moderator email required");
    }

    const auditId = crypto.randomUUID();

    const updateStatement = db
        .prepare(
            `UPDATE incidents
             SET
                 status = ?,
                 reviewed_at = CURRENT_TIMESTAMP,
                 published_at = CASE
                     WHEN ? = 'approved'
                         THEN CURRENT_TIMESTAMP
                     ELSE NULL
                 END
             WHERE id = ?
               AND status = 'pending'
             RETURNING
                 id,
                 status,
                 reviewed_at,
                 published_at`
        )
        .bind(decision, decision, id);

    const auditStatement = db
        .prepare(
            `INSERT INTO moderation_audit (
                 id,
                 incident_id,
                 moderator_email,
                 action,
                 previous_status,
                 new_status
             )
             SELECT
                 ?,
                 ?,
                 ?,
                 ?,
                 'pending',
                 ?
             WHERE changes() = 1`
        )
        .bind(
            auditId,
            id,
            email,
            decision,
            decision
        );

    // D1 guarantees batch statements execute
    // sequentially as a transaction.
    const results = await db.batch([
        updateStatement,
        auditStatement,
    ]);

    const update = results[0];
    const audit = results[1];

    if (!update.success || !audit.success) {
        throw new Error("Review transaction failed");
    }

    const incident = (
        update.results as unknown as ReviewedIncident[]
    )[0];

    if (incident) {
        // A successful review must have a matching audit.
        if (
            update.meta.changes !== 1 ||
            audit.meta.changes !== 1
        ) {
            throw new Error(
                "Review/audit consistency failure"
            );
        }

        return {
            outcome: "reviewed",
            incident,
        };
    }

    // Neither the incident nor audit should change.
    if (
        update.meta.changes !== 0 ||
        audit.meta.changes !== 0
    ) {
        throw new Error(
            "Unexpected review transaction result"
        );
    }

    /**
     * Distinguish nonexistent incidents from incidents
     * that have already been reviewed.
     */
    const existing = await db
        .prepare(
            `SELECT id
             FROM incidents
             WHERE id = ?`
        )
        .bind(id)
        .first<{ id: string }>();

    if (!existing) {
        return {
            outcome: "not_found",
        };
    }

    return {
        outcome: "already_reviewed",
    };
}
