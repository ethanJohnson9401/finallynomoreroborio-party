
/**
 * Private roboRIO Trauma Center database operations.
 *
 * Features:
 * - Cursor-based pending incident pagination
 * - Accurate total pending incident count
 * - Atomic approval/rejection
 * - Moderation audit trail
 * - Double-review protection
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

interface QueueCursor {
    created_at: string;
    id: string;
}

export interface PendingIncidentPage {
    incidents: PendingIncident[];
    total: number;
    nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMESTAMP_PATTERN =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Encode the position of the last incident
 * on a page into an opaque URL-safe cursor.
 */
function encodeQueueCursor(
    incident: PendingIncident
): string {
    const cursor: QueueCursor = {
        created_at: incident.created_at,
        id: incident.id,
    };

    return btoa(JSON.stringify(cursor))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

/**
 * Validate and decode a pagination cursor.
 *
 * Reject malformed, oversized, or structurally
 * invalid cursors.
 */
function decodeQueueCursor(
    value: string
): QueueCursor | null {
    try {
        if (
            value.length > 256 ||
            !/^[A-Za-z0-9_-]+$/.test(value)
        ) {
            return null;
        }

        const normalized = value
            .replace(/-/g, "+")
            .replace(/_/g, "/");

        const parsed: unknown = JSON.parse(
            atob(normalized)
        );

        if (
            !parsed ||
            typeof parsed !== "object"
        ) {
            return null;
        }

        const cursor = parsed as Partial<QueueCursor>;

        if (
            typeof cursor.created_at !== "string" ||
            !TIMESTAMP_PATTERN.test(cursor.created_at) ||
            typeof cursor.id !== "string" ||
            !UUID_PATTERN.test(cursor.id)
        ) {
            return null;
        }

        return {
            created_at: cursor.created_at,
            id: cursor.id,
        };
    } catch {
        return null;
    }
}

/**
 * Retrieve one page of pending incidents.
 *
 * Uses keyset pagination ordered by:
 *
 * 1. created_at DESC
 * 2. id DESC
 *
 * The total is the number of pending reports
 * across the entire moderation queue.
 */
export async function getPendingIncidentPage(
    db: D1Database,
    cursorValue: string | null = null,
    limit = DEFAULT_PAGE_SIZE
): Promise<PendingIncidentPage> {
    if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > MAX_PAGE_SIZE
    ) {
        throw new RangeError("INVALID_LIMIT");
    }

    const cursor =
        cursorValue === null
            ? null
            : decodeQueueCursor(cursorValue);

    if (cursorValue !== null && !cursor) {
        throw new RangeError("INVALID_CURSOR");
    }

    const cursorCondition = cursor
        ? `
          AND (
              created_at < ?
              OR (
                  created_at = ?
                  AND id < ?
              )
          )
        `
        : "";

    const statement = db.prepare(`
        SELECT
            id,
            story,
            status,
            created_at
        FROM incidents
        WHERE status = 'pending'
        ${cursorCondition}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `);

    const pageQuery = cursor
        ? statement.bind(
            cursor.created_at,
            cursor.created_at,
            cursor.id,
            limit + 1
        )
        : statement.bind(limit + 1);

    const countQuery = db.prepare(`
        SELECT COUNT(*) AS total
        FROM incidents
        WHERE status = 'pending'
    `);

    const results = await db.batch([
        pageQuery,
        countQuery,
    ]);

    const pageResult = results[0];
    const countResult = results[1];

    if (
        !pageResult.success ||
        !countResult.success
    ) {
        throw new Error(
            "Failed to retrieve moderation queue"
        );
    }

    const rows =
        pageResult.results as unknown as PendingIncident[];

    const totalRow =
        countResult.results[0] as
            | { total: number }
            | undefined;

    if (!totalRow) {
        throw new Error(
            "Pending incident count unavailable"
        );
    }

    const incidents = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    const lastIncident = incidents.at(-1);

    return {
        incidents,
        total: totalRow.total,
        nextCursor:
            hasMore && lastIncident
                ? encodeQueueCursor(lastIncident)
                : null,
    };
}

/**
 * Legacy convenience function.
 *
 * Retained for compatibility with any existing
 * internal callers that need the first N reports.
 *
 * New API code should use getPendingIncidentPage().
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
 * Review exactly one pending incident.
 *
 * Both statements run atomically in a D1 batch.
 *
 * Statement 1:
 * - Updates pending -> approved/rejected
 * - Records review timestamp
 * - Records publication timestamp only on approval
 *
 * Statement 2:
 * - Inserts the moderator audit record
 * - Executes only when the previous UPDATE
 *   changed exactly one incident
 *
 * If a statement fails, D1 rolls back the batch.
 */
export async function reviewIncident(
    db: D1Database,
    id: string,
    decision: ReviewDecision,
    moderatorEmail: string
): Promise<ReviewResult> {
    const email = moderatorEmail.trim().toLowerCase();

    if (!email) {
        throw new Error(
            "Verified moderator email required"
        );
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

    /**
     * D1 executes all batch statements in a
     * single transaction.
     */
    const results = await db.batch([
        updateStatement,
        auditStatement,
    ]);

    const update = results[0];
    const audit = results[1];

    if (
        !update.success ||
        !audit.success
    ) {
        throw new Error(
            "Review transaction failed"
        );
    }

    const incident = (
        update.results as unknown as ReviewedIncident[]
    )[0];

    if (incident) {
        /**
         * The review and its audit record
         * must have changed exactly one row each.
         */
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

    /**
     * No review occurred.
     *
     * Ensure there were no unexpected writes.
     */
    if (
        update.meta.changes !== 0 ||
        audit.meta.changes !== 0
    ) {
        throw new Error(
            "Unexpected review transaction result"
        );
    }

    /**
     * Distinguish an unknown incident from one
     * that has already been reviewed.
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


/**
 * Moderator-controlled incident withdrawal.
 *
 * Withdrawals remove an approved report from public
 * visibility without permanently deleting its contents.
 */

export interface WithdrawnIncident {
    id: string;
    status: "approved";
    withdrawn_at: string;
    published_at: null;
}

export type WithdrawalResult =
    | {
    outcome: "withdrawn";
    incident: WithdrawnIncident;
}
    | {
    outcome: "not_found";
}
    | {
    outcome: "not_withdrawable";
};

/**
 * Atomically withdraw an approved report and record
 * which moderator performed the action.
 *
 * Reasons are private and must not be returned through
 * the public archive.
 */
export async function withdrawIncident(
    db: D1Database,
    id: string,
    moderatorEmail: string,
    reason: string
): Promise<WithdrawalResult> {
    const email = moderatorEmail.trim().toLowerCase();
    const cleanReason = reason.trim();

    if (!email) {
        throw new Error("VERIFIED_MODERATOR_REQUIRED");
    }

    if (
        cleanReason.length < 10 ||
        cleanReason.length > 500
    ) {
        throw new RangeError("INVALID_WITHDRAWAL_REASON");
    }

    const auditId = crypto.randomUUID();

    const updateStatement = db
        .prepare(
            `UPDATE incidents
             SET
                 withdrawn_at = CURRENT_TIMESTAMP,
                 published_at = NULL
             WHERE id = ?
               AND status = 'approved'
               AND withdrawn_at IS NULL
             RETURNING
                 id,
                 status,
                 withdrawn_at,
                 published_at`
        )
        .bind(id);

    const auditStatement = db
        .prepare(
            `INSERT INTO incident_withdrawal_audit (
                id,
                incident_id,
                moderator_email,
                reason
             )
             SELECT ?, ?, ?, ?
             WHERE changes() = 1`
        )
        .bind(
            auditId,
            id,
            email,
            cleanReason
        );

    /**
     * Both operations run in one D1 transaction.
     * If the audit insert fails, the database update
     * must also roll back.
     */
    const results = await db.batch([
        updateStatement,
        auditStatement,
    ]);

    const update = results[0];
    const audit = results[1];

    if (!update.success || !audit.success) {
        throw new Error("WITHDRAWAL_TRANSACTION_FAILED");
    }

    const incident = (
        update.results as unknown as WithdrawnIncident[]
    )[0];

    if (incident) {
        if (
            update.meta.changes !== 1 ||
            audit.meta.changes !== 1
        ) {
            throw new Error("WITHDRAWAL_AUDIT_MISMATCH");
        }

        return {
            outcome: "withdrawn",
            incident,
        };
    }

    if (
        update.meta.changes !== 0 ||
        audit.meta.changes !== 0
    ) {
        throw new Error("UNEXPECTED_WITHDRAWAL_RESULT");
    }

    const existing = await db
        .prepare(
            "SELECT id FROM incidents WHERE id = ?"
        )
        .bind(id)
        .first<{ id: string }>();

    return existing
        ? { outcome: "not_withdrawable" }
        : { outcome: "not_found" };
}

