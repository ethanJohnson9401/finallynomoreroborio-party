
/**
 * finallynomoreroborio.party
 * Cloudflare Worker API
 *
 * Features:
 * - Health checks
 * - D1 connectivity
 * - CORS protection
 * - Request-size limits
 * - Incident validation
 * - Submission configuration security
 * - Rate limiting
 * - Turnstile verification
 * - Moderated incident storage
 */

import {
	countIncidents,
	createIncident,
	getPendingIncidents,
} from "./db/incidents";

import { checkIncidentRateLimit } from "./security/rateLimit";

import {
	checkSubmissionAccess,
} from "./security/submissionConfig";

import { verifyTurnstile } from "./security/turnstile";

import {
	addCorsHeaders,
	handleCorsPreflight,
	isAllowedOrigin,
} from "./utils/cors";

import { readJsonBody } from "./utils/request";
import { jsonResponse } from "./utils/response";
import { validateIncident } from "./validation/incident";

import {
	authorizeModerator,
} from "./security/moderatorAuth";

/**
 * Cloudflare Worker environment bindings.
 */
interface Env {
	DB: D1Database;

	INCIDENT_LIMITER: RateLimit;

	DEPLOYMENT_ENV?: string;
	ENABLE_INCIDENT_SUBMISSIONS?: string;

	TURNSTILE_SECRET_KEY: string;
	TURNSTILE_TEST_MODE?: string;

	MODERATOR_EMAILS?: string;
}

/**
 * Main Worker entry point.
 */
export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url);


		/**
		 * Administrator-only incident review API.
		 *
		 * Handle this route before the public CORS logic
		 * and before the normal application routes.
		 */
		if (url.pathname === "/api/admin/incidents") {
			if (request.method !== "GET") {
				return jsonResponse(
					{ error: "METHOD_NOT_ALLOWED" },
					405
				);
			}

			/**
			 * Require verified Cloudflare Access identity
			 * and membership in our moderator allowlist.
			 */
			const authorization = await authorizeModerator(
				{ access: ctx.access },
				env
			);

			if (!authorization.authorized) {
				const status =
					authorization.reason === "UNAUTHENTICATED"
						? 401
						: 403;

				return jsonResponse(
					{ error: authorization.reason },
					status
				);
			}

			/**
			 * Only authenticated moderators reach this code.
			 */
			try {
				const incidents = await getPendingIncidents(
					env.DB
				);

				return jsonResponse({
					status: "ok",
					incidents,
					count: incidents.length,
				});
			} catch (error) {
				console.error(
					"Failed to load moderation queue:",
					error
				);

				return jsonResponse(
					{ error: "MODERATION_QUEUE_UNAVAILABLE" },
					503
				);
			}
		}


		/**
		 * Handle CORS preflight.
		 */
		if (
			url.pathname === "/api/incidents" &&
			request.method === "OPTIONS"
		) {
			return handleCorsPreflight(request);
		}

		/**
		 * Reject unapproved browser origins.
		 *
		 * CORS is not authentication.
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

		const response = await handleRequest(
			request,
			env
		);

		return addCorsHeaders(request, response);
	},
};

/**
 * Application routes.
 */
async function handleRequest(
	request: Request,
	env: Env
): Promise<Response> {
	const url = new URL(request.url);

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
	 */
	if (url.pathname === "/api/incidents") {
		if (request.method !== "POST") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		/**
		 * Require application/json.
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
		 * Read JSON with the existing 8 KB limit.
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
		 * Validate the submitted story.
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
		 * Check deployment configuration BEFORE
		 * using rate limiting or Turnstile.
		 *
		 * Unsafe configuration cannot reach D1 writes.
		 */
		const access = checkSubmissionAccess(env);

		if (!access.allowed) {
			return jsonResponse(
				{ error: access.reason },
				503
			);
		}

		/**
		 * Apply Cloudflare rate limiting.
		 */
		let withinLimit: boolean;

		try {
			withinLimit = await checkIncidentRateLimit(
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
		 * Verify Turnstile using the permitted mode.
		 */
		const verified = await verifyTurnstile(
			turnstileToken,
			env.TURNSTILE_SECRET_KEY,
			access.testMode
		);

		if (!verified) {
			return jsonResponse(
				{ error: "TURNSTILE_VERIFICATION_FAILED" },
				403
			);
		}

		/**
		 * Store the incident as pending moderation.
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
