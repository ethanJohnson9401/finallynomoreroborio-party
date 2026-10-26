
/**
 * Public roboRIO Incident Memorial archive.
 *
 * Only approved, non-test incidents are returned.
 * Private moderation records are never selected.
 */

export interface PublicIncident {
	id: string;
	story: string;
	published_at: string;
}

interface CursorData {
	published_at: string;
	id: string;
}

export interface ApprovedIncidentPage {
	incidents: PublicIncident[];
	nextCursor: string | null;
}

export type ApprovedIncidentResult =
	| ApprovedIncidentPage
	| { error: "INVALID_LIMIT" | "INVALID_CURSOR" };

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIMESTAMP_PATTERN =
	/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

/**
 * Decode and validate an opaque pagination cursor.
 */
function decodeCursor(value: string): CursorData | null {
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

		const data = parsed as Partial<CursorData>;

		if (
			typeof data.published_at !== "string" ||
			!TIMESTAMP_PATTERN.test(data.published_at)
		) {
			return null;
		}

		if (
			typeof data.id !== "string" ||
			!UUID_PATTERN.test(data.id)
		) {
			return null;
		}

		return {
			published_at: data.published_at,
			id: data.id,
		};
	} catch {
		return null;
	}
}

/**
 * Encode the last visible record as the next cursor.
 */
function encodeCursor(data: CursorData): string {
	return btoa(JSON.stringify(data))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/**
 * Retrieve public incidents using keyset pagination.
 *
 * Order:
 * 1. Publication time, newest first.
 * 2. Incident ID, descending, as a tie breaker.
 */
export async function getApprovedIncidents(
	db: D1Database,
	url: URL
): Promise<ApprovedIncidentResult> {
	const rawLimit = url.searchParams.get("limit");

	const limit =
		rawLimit === null
			? DEFAULT_LIMIT
			: Number(rawLimit);

	if (
		rawLimit !== null &&
		!/^(?:[1-9]|1[0-9]|20)$/.test(rawLimit)
	) {
		return { error: "INVALID_LIMIT" };
	}

	if (
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > MAX_LIMIT
	) {
		return { error: "INVALID_LIMIT" };
	}

	const rawCursor = url.searchParams.get("cursor");

	const cursor =
		rawCursor === null
			? null
			: decodeCursor(rawCursor);

	if (rawCursor !== null && !cursor) {
		return { error: "INVALID_CURSOR" };
	}

	const baseQuery = `
        SELECT
            id,
            story,
            published_at
        FROM incidents
        WHERE status = 'approved'
          AND is_test = 0
          AND published_at IS NOT NULL
    `;

	const cursorCondition = cursor
		? `
          AND (
              published_at < ?
              OR (
                  published_at = ?
                  AND id < ?
              )
          )
        `
		: "";

	const statement = db.prepare(`
        ${baseQuery}
        ${cursorCondition}
        ORDER BY published_at DESC, id DESC
        LIMIT ?
    `);

	// Fetch one extra row to detect another page.
	const query = cursor
		? statement.bind(
			cursor.published_at,
			cursor.published_at,
			cursor.id,
			limit + 1
		)
		: statement.bind(limit + 1);

	const result = await query.all<PublicIncident>();

	if (!result.success) {
		throw new Error(
			"Unable to retrieve approved incidents"
		);
	}

	const hasMore = result.results.length > limit;

	const incidents = result.results.slice(0, limit);

	const last = incidents.at(-1);

	return {
		incidents,
		nextCursor:
			hasMore && last
				? encodeCursor({
					published_at: last.published_at,
					id: last.id,
				})
				: null,
	};
}
