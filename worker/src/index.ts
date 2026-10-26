
/**
 * finallynomoreroborio.party
 * Cloudflare Worker API
 *
 * Provides incident validation, Turnstile verification,
 * database health checks, and CORS handling.
 *
 * Public submissions are not enabled yet.
 */

import { countIncidents } from "./db/incidents";
import { verifyTurnstile } from "./security/turnstile";
import { readJsonBody } from "./utils/request";
import { jsonResponse } from "./utils/response";

import {
	addCorsHeaders,
	handleCorsPreflight,
	isAllowedOrigin,
} from "./utils/cors";
import {validateIncident} from "./validation/incident";

interface Env {
	DB: D1Database;
	TURNSTILE_SECRET_KEY: string;
}

/**
 * Main Cloudflare Worker entry point.
 */
export default {
	async fetch(
		request: Request,
		env: Env
	): Promise<Response> {
		const url = new URL(request.url);

		/**
		 * Handle browser CORS preflight requests.
		 */
		if (
			url.pathname === "/api/incidents" &&
			request.method === "OPTIONS"
		) {
			return handleCorsPreflight(request);
		}

		/**
		 * Reject browser requests from unapproved origins.
		 *
		 * Requests without an Origin header are still
		 * permitted for local CLI testing.
		 */
		if (
			url.pathname === "/api/incidents" &&
			request.method === "POST"
		) {
			const origin = request.headers.get("Origin");

			if (origin && !isAllowedOrigin(origin)) {
				return jsonResponse(
					{ error: "ORIGIN_NOT_ALLOWED" },
					403
				);
			}
		}

		/**
		 * Execute the requested API route.
		 */
		const response = await handleRequest(request, env);

		/**
		 * Attach CORS response headers where allowed.
		 */
		return addCorsHeaders(request, response);
	},
};

/**
 * Application API routes.
 */
async function handleRequest(
	request: Request,
	env: Env
): Promise<Response> {
	const url = new URL(request.url);

	/**
	 * GET /api/health
	 *
	 * Check whether the Worker is running.
	 */
	if (url.pathname === "/api/health") {
		if (request.method !== "GET") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		return jsonResponse({
			status: "ok",
			service: "roborio-trauma-api",
		});
	}

	/**
	 * GET /api/health/db
	 *
	 * Verify D1 connectivity and count incidents.
	 */
	if (url.pathname === "/api/health/db") {
		if (request.method !== "GET") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		try {
			const incidentCount = await countIncidents(
				env.DB
			);

			return jsonResponse({
				status: "ok",
				database: "connected",
				incidents: incidentCount,
			});
		} catch (error) {
			console.error(
				"D1 health check failed:",
				error
			);

			return jsonResponse(
				{
					status: "error",
					database: "unavailable",
				},
				503
			);
		}
	}

	/**
	 * POST /api/incidents
	 *
	 * Validate incident reports and verify Turnstile.
	 * Reports are NOT stored yet.
	 */
	if (url.pathname === "/api/incidents") {
		if (request.method !== "POST") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		/**
		 * Require JSON requests.
		 */
		const contentType =
			request.headers.get("content-type") ?? "";

		if (
			!contentType
				.toLowerCase()
				.includes("application/json")
		) {
			return jsonResponse(
				{ error: "UNSUPPORTED_MEDIA_TYPE" },
				415
			);
		}

		/**
		 * Read JSON with an 8 KB request-size limit.
		 */
		const parsed = await readJsonBody(request);

		if (!parsed.ok) {
			return jsonResponse(
				{ error: parsed.error },
				parsed.status
			);
		}

		const body = parsed.body;

		/**
		 * Validate the incident story.
		 */
		const validation = validateIncident(body);

		if (!validation.valid) {
			return jsonResponse(
				{ error: validation.error },
				400
			);
		}

		/**
		 * Extract the Turnstile token.
		 */
		const turnstileToken =
			typeof body === "object" &&
			body !== null &&
			!Array.isArray(body) &&
			"turnstileToken" in body &&
			typeof body.turnstileToken === "string"
				? body.turnstileToken
				: "";

		if (!turnstileToken) {
			return jsonResponse(
				{ error: "TURNSTILE_TOKEN_REQUIRED" },
				400
			);
		}

		/**
		 * Verify the token with Cloudflare.
		 */
		const verified = await verifyTurnstile(
			turnstileToken,
			env.TURNSTILE_SECRET_KEY
		);

		if (!verified) {
			return jsonResponse(
				{ error: "TURNSTILE_VERIFICATION_FAILED" },
				403
			);
		}

		/**
		 * Validation and Turnstile verification passed.
		 *
		 * Future submission pipeline:
		 * 1. Verify the expected Turnstile hostname/action.
		 * 2. Implement rate limiting and abuse controls.
		 * 3. Generate a unique incident ID.
		 * 4. Insert the report into D1 as pending.
		 * 5. Return a submission confirmation.
		 *
		 * Public submissions are intentionally disabled.
		 */
		return jsonResponse(
			{
				status: "not_implemented",
				message:
					"Submission storage is not enabled yet.",
			},
			501
		);
	}

	/**
	 * Unknown API endpoint.
	 */
	return jsonResponse(
		{ error: "NOT_FOUND" },
		404
	);
}
