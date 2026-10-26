
/**
 * finallynomoreroborio.party
 * Cloudflare Worker API
 *
 * Features:
 * - Public health checks
 * - Privacy-safe D1 connectivity checks
 * - CORS protection
 * - Incident validation
 * - Rate limiting
 * - Turnstile verification
 * - Idempotent moderated submissions
 * - Public approved-incidents archive
 */

import {
	createIdempotentIncident,
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
}

/**
 * Require a properly formatted UUID.
 *
 * The frontend will generate this using
 * crypto.randomUUID().
 */
const SUBMISSION_KEY_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const worker = {
	async fetch(
		request: Request,
		env: Env
	): Promise<Response> {
		const url = new URL(request.url);

		/**
		 * Handle CORS preflight for submissions.
		 */
		if (
			url.pathname === "/api/incidents" &&
			request.method === "OPTIONS"
		) {
			return handleCorsPreflight(request);
		}

		/**
		 * Reject incident submissions from
		 * disallowed browser origins.
		 *
		 * CORS is not an authentication mechanism.
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

		return addCorsHeaders(
			request,
			response
		);
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
	 * Report whether submissions are currently enabled.
	 * Never disclose deployment secrets.
	 */
	if (
		url.pathname === "/api/incidents/config"
	) {
		if (request.method !== "GET") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		const access =
			checkSubmissionAccess(env);

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
	 *
	 * Verify D1 connectivity without revealing
	 * incident counts or moderation information.
	 */
	if (url.pathname === "/api/health/db") {
		if (request.method !== "GET") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		try {
			await env.DB
				.prepare("SELECT 1 AS healthy")
				.first();

			return jsonResponse({
				status: "ok",
				database: "connected",
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
	 * Remains available when submissions are disabled.
	 */
	if (
		url.pathname ===
		"/api/incidents/approved"
	) {
		if (request.method !== "GET") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		try {
			const result =
				await getApprovedIncidents(
					env.DB,
					url
				);

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
	 * Every new incident begins pending.
	 * Repeated verified requests with the same key
	 * return the original receipt.
	 */
	if (url.pathname === "/api/incidents") {
		if (request.method !== "POST") {
			return jsonResponse(
				{ error: "METHOD_NOT_ALLOWED" },
				405
			);
		}

		/**
		 * Require JSON.
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
		 * Enforce request body size limit
		 * and parse JSON safely.
		 */
		const parsed =
			await readJsonBody(request);

		if (!parsed.ok) {
			return jsonResponse(
				{ error: parsed.error },
				parsed.status
			);
		}

		const body = parsed.body;

		/**
		 * Validate incident story.
		 */
		const validation =
			validateIncident(body);

		if (!validation.valid) {
			return jsonResponse(
				{ error: validation.error },
				400
			);
		}

		/**
		 * Extract Turnstile token.
		 */
		const turnstileToken =
			typeof body === "object" &&
			body !== null &&
			!Array.isArray(body) &&
			"turnstileToken" in body &&
			typeof body.turnstileToken ===
			"string"
				? body.turnstileToken
				: "";

		if (!turnstileToken) {
			return jsonResponse(
				{
					error: "TURNSTILE_TOKEN_REQUIRED",
				},
				400
			);
		}

		/**
		 * Extract and validate submission UUID.
		 *
		 * This key is NOT an authentication token.
		 */
		const submissionKey =
			typeof body === "object" &&
			body !== null &&
			!Array.isArray(body) &&
			"submissionKey" in body &&
			typeof body.submissionKey ===
			"string"
				? body.submissionKey
				: "";

		if (
			submissionKey.length !== 36 ||
			!SUBMISSION_KEY_PATTERN.test(
				submissionKey
			)
		) {
			return jsonResponse(
				{
					error: "INVALID_SUBMISSION_KEY",
				},
				400
			);
		}

		/**
		 * Verify submission configuration BEFORE
		 * rate limiting, Turnstile, or D1 writes.
		 *
		 * Unsafe configuration fails closed.
		 */
		const access =
			checkSubmissionAccess(env);

		if (!access.allowed) {
			return jsonResponse(
				{ error: access.reason },
				503
			);
		}

		/**
		 * Enforce Cloudflare rate limiting.
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
				{
					error: "RATE_LIMIT_UNAVAILABLE",
				},
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
		 * Verify Turnstile server-side.
		 *
		 * Idempotency NEVER bypasses verification.
		 */
		const verified =
			await verifyTurnstile(
				turnstileToken,
				env.TURNSTILE_SECRET_KEY,
				access.testMode
			);

		if (!verified) {
			return jsonResponse(
				{
					error: "TURNSTILE_VERIFICATION_FAILED",
				},
				403
			);
		}

		/**
		 * Atomically create or reuse a pending
		 * incident by submission key.
		 *
		 * Never expose its current moderation status
		 * when returning a replay receipt.
		 */
		try {
			const result =
				await createIdempotentIncident(
					env.DB,
					validation.story,
					submissionKey
				);

			if (result.outcome === "conflict") {
				return jsonResponse(
					{
						error: "SUBMISSION_KEY_CONFLICT",
					},
					409
				);
			}

			return jsonResponse(
				{
					status: "received",
					id: result.id,
					moderation: "pending",
					message:
						"Incident report received for review.",
				},
				result.outcome === "created"
					? 201
					: 200
			);
		} catch (error) {
			console.error(
				"Incident creation failed:",
				error
			);

			return jsonResponse(
				{
					error: "INCIDENT_STORAGE_FAILED",
				},
				503
			);
		}
	}

	/**
	 * Unknown API endpoint.
	 */
	return jsonResponse(
		{ error: "NOT_FOUND" },
		404
	);
}
