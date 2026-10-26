
/**
 * Database operations for roboRIO incident reports.
 *
 * All SQL queries related to incidents live here.
 */

export interface IncidentCount {
	total: number;
}

/**
 * Count all incident reports, regardless of status.
 */
export async function countIncidents(
	db: D1Database
): Promise<number> {
	const result = await db
		.prepare("SELECT COUNT(*) AS total FROM incidents")
		.first<IncidentCount>();

	if (!result) {
		throw new Error(
			"Incident count query returned no result"
		);
	}

	return result.total;
}

export interface CreateIncidentResult {
	id: string;
	status: "pending";
}

/**
 * Legacy database helper.
 *
 * Preserved for existing tests and internal callers.
 * New public submissions should use the idempotent helper.
 */
export async function createIncident(
	db: D1Database,
	story: string
): Promise<CreateIncidentResult> {
	const id = crypto.randomUUID();

	const result = await db
		.prepare(
			`INSERT INTO incidents (id, story, status)
			 VALUES (?, ?, 'pending')`
		)
		.bind(id, story)
		.run();

	if (!result.success) {
		throw new Error("Failed to create incident report");
	}

	return {
		id,
		status: "pending",
	};
}

export type IdempotentIncidentResult =
	| {
	outcome: "created";
	id: string;
}
	| {
	outcome: "replayed";
	id: string;
}
	| {
	outcome: "conflict";
};

/**
 * Create at most one incident for a submission key.
 *
 * The UNIQUE index on submission_key handles concurrency.
 * A conflicting insert performs no write, then the original
 * row is retrieved and compared with the submitted story.
 *
 * Must be called only after rate limiting and Turnstile
 * verification have completed successfully.
 */
export async function createIdempotentIncident(
	db: D1Database,
	story: string,
	submissionKey: string
): Promise<IdempotentIncidentResult> {
	const id = crypto.randomUUID();

	const insertion = await db
		.prepare(
			`INSERT INTO incidents (
				id,
				story,
				status,
				submission_key
			)
			 VALUES (?, ?, 'pending', ?)
				 ON CONFLICT(submission_key)
			 WHERE submission_key IS NOT NULL
				 DO NOTHING`
		)
		.bind(id, story, submissionKey)
		.run();

	if (!insertion.success) {
		throw new Error("INCIDENT_INSERT_FAILED");
	}

	if (insertion.meta.changes === 1) {
		return {
			outcome: "created",
			id,
		};
	}

	const existing = await db
		.prepare(
			`SELECT id, story
             FROM incidents
             WHERE submission_key = ?`
		)
		.bind(submissionKey)
		.first<{
			id: string;
			story: string;
		}>();

	if (!existing) {
		throw new Error("IDEMPOTENCY_LOOKUP_FAILED");
	}

	if (existing.story !== story) {
		return {
			outcome: "conflict",
		};
	}

	return {
		outcome: "replayed",
		id: existing.id,
	};
}

/**
 * Incident information visible to moderators.
 */
export interface PendingIncident {
	id: string;
	story: string;
	status: "pending";
	created_at: string;
}

/**
 * Retrieve incidents awaiting moderation.
 *
 * Must be called only after moderator authorization.
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
