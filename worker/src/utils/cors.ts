
/**
 * CORS configuration for the Trauma Center API.
 */

const ALLOWED_ORIGINS = new Set([
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"https://finallynomoreroborio.party",
	"https://www.finallynomoreroborio.party",
]);

export function isAllowedOrigin(origin: string): boolean {
	return ALLOWED_ORIGINS.has(origin);
}

export function handleCorsPreflight(
	request: Request
): Response {
	const origin = request.headers.get("Origin");

	if (!origin || !isAllowedOrigin(origin)) {
		return Response.json(
			{ error: "ORIGIN_NOT_ALLOWED" },
			{ status: 403 }
		);
	}

	const method = request.headers.get(
		"Access-Control-Request-Method"
	);

	if (method !== "POST") {
		return new Response(null, {
			status: 405,
			headers: {
				Allow: "POST",
			},
		});
	}

	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Access-Control-Max-Age": "600",
			"Vary": "Origin",
		},
	});
}

export function addCorsHeaders(
	request: Request,
	response: Response
): Response {
	const origin = request.headers.get("Origin");

	if (!origin || !isAllowedOrigin(origin)) {
		return response;
	}

	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", origin);
	headers.append("Vary", "Origin");

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
