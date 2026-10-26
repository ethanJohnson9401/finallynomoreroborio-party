
/**
 * Database operations for roboRIO incident reports.
 *
 * All SQL queries related to incidents will live here.
 */

export interface IncidentCount {
	total: number;
}

/**
 * Count all incident reports in the D1 database.
 *
 * Includes pending, approved, and rejected reports.
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
 * Store an incident report for moderation.
 *
 * This function only writes to D1.
 * It does not publish or approve reports.
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

