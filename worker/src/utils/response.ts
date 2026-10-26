
/**
 * Shared HTTP response utilities.
 */

export function jsonResponse(
	data: unknown,
	status = 200
): Response {
	return Response.json(data, {
		status,
		headers: {
			"Cache-Control": "no-store",
		},
	});
}
