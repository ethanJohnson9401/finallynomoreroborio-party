
/**
 * finallynomoreroborio.party
 * Cloudflare Worker API
 *
 * Features:
 * - Health checks
 * - D1 connectivity
 * - CORS protection
 * - Incident validation
 * - Rate limiting
 * - Turnstile verification
 * - Moderated submissions
 * - Public approved-incidents archive
 */

import {
	countIncidents,
	createIncident,
} from "./db/incidents";

import {
	getApprovedIncidents,
} from "./db/approvedIncidents";

import {
	checkIncidentRateLimit,
} from "./security/rateLimit";

import {
	checkSubmissionAccess,
} from "./security/submissionConfig";

import {
	verifyTurnstile,
} from "./security/turnstile";

import {
	addCorsHeaders,
	handleCorsPreflight,
	isAllowedOrigin,
} from "./utils/cors";

import { readJsonBody } from "./utils/request";
import { jsonResponse } from "./utils/response";
import { validateIncident } from "./validation/incident";

interface Env {
	DB: D1Database;

	INCIDENT_LIMITER: RateLimit;

	DEPLOYMENT_ENV?: string;
	ENABLE_INCIDENT_SUBMISSIONS?: string;

	TURNSTILE_SECRET_KEY: string;
	TURNSTILE_TEST_MODE?: string;
}

const worker = {
	async fetch(
		request: Request,
		env: Env
	): Promise<Response> {
		const url = new URL(request.url);

		/**
		 * Handle submission preflight.
		 */
		if (
			url.pathname === "/api/incidents" &&
			request.method === "OPTIONS"
		) {
			return handleCorsPreflight(request);
		}

		/**
		 * Restrict public submission origins.
		 */
		if (
			url.pathname === "/api/incidents" &&
			request.method === "POST"
		) {
			const origin =
				request.headers.get("Origin");

			if (
				origin &&
				!isAllowedOrigin(origin)
			) {
				return jsonResponse(
					{ error: "ORIGIN_NOT_ALLOWED" },
					403
				);
			}
		}

		const response = await handleRequest(
			request,
			env
		);

		return addCorsHeaders(request, response);
	},
};

export default worker;

/**
 * Application routes.
 */
async function handleRequest(
	request: Request,
	env: Env
): Promise<Response> {
	const url = new URL(request.url);


	/**
	 * GET /api/incidents/config
	 *
	 * Public, read-only intake availability.
	 * Never expose secrets or internal configuration.
	 */
	if (url.pathname === "/api/incidents/config") {
		if (request.method !== "GET") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		const access = checkSubmissionAccess(env);

		return jsonResponse({
			submissionsEnabled: access.allowed,
		});
	}


	/**
	 * GET /api/health
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
	 */
	if (url.pathname === "/api/health/db") {
		if (request.method !== "GET") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		try {
			const incidentCount =
				await countIncidents(env.DB);

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
	 * GET /api/incidents/approved
	 *
	 * Public, read-only incident archive.
	 *
	 * Query parameters:
	 * - limit: 1 to 20, default 8
	 * - cursor: optional pagination cursor
	 *
	 * This endpoint does not depend on whether
	 * new incident submissions are enabled.
	 */
	if (
		url.pathname === "/api/incidents/approved"
	) {
		if (request.method !== "GET") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		try {
			const result =
				await getApprovedIncidents(env.DB, url);

			if ("error" in result) {
				return jsonResponse(
					{ error: result.error },
					400
				);
			}

			return jsonResponse(result);
		} catch (error) {
			console.error(
				"Public incident archive failed:",
				error
			);

			return jsonResponse(
				{ error: "ARCHIVE_UNAVAILABLE" },
				503
			);
		}
	}

	/**
	 * POST /api/incidents
	 *
	 * Anonymous incident submission.
	 * All new reports start in pending status.
	 */
	if (url.pathname === "/api/incidents") {
		if (request.method !== "POST") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		/**
		 * Require JSON content.
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
		 * Parse JSON with the existing body size limit.
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
		 * Validate the submitted report.
		 */
		const validation = validateIncident(body);

		if (!validation.valid) {
			return jsonResponse(
				{ error: validation.error },
				400
			);
		}

		/**
		 * Extract Turnstile verification token.
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
		 * Enforce submission configuration.
		 *
		 * Unsafe or missing configuration
		 * must fail closed.
		 */
		const access = checkSubmissionAccess(env);

		if (!access.allowed) {
			return jsonResponse(
				{ error: access.reason },
				503
			);
		}

		/**
		 * Enforce rate limiting.
		 */
		let withinLimit: boolean;

		try {
			withinLimit =
				await checkIncidentRateLimit(
					env.INCIDENT_LIMITER,
					request
				);
		} catch (error) {
			console.error(
				"Incident rate limiter failed:",
				error
			);

			return jsonResponse(
				{ error: "RATE_LIMIT_UNAVAILABLE" },
				503
			);
		}

		if (!withinLimit) {
			return jsonResponse(
				{ error: "RATE_LIMITED" },
				429
			);
		}

		/**
		 * Verify Cloudflare Turnstile token.
		 */
		const verified = await verifyTurnstile(
			turnstileToken,
			env.TURNSTILE_SECRET_KEY,
			access.testMode
		);

		if (!verified) {
			return jsonResponse(
				{
					error:
						"TURNSTILE_VERIFICATION_FAILED",
				},
				403
			);
		}

		/**
		 * Store new incident for moderation.
		 */
		try {
			const incident = await createIncident(
				env.DB,
				validation.story
			);

			return jsonResponse(
				{
					status: "received",
					id: incident.id,
					moderation: incident.status,
					message:
						"Incident report received for review.",
				},
				201
			);
		} catch (error) {
			console.error(
				"Incident creation failed:",
				error
			);

			return jsonResponse(
				{ error: "INCIDENT_STORAGE_FAILED" },
				503
			);
		}
	}

	/**
	 * Unknown endpoint.
	 */
	return jsonResponse(
		{ error: "NOT_FOUND" },
		404
	);
}
