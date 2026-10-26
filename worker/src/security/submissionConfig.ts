
/**
 * Incident submission configuration.
 *
 * This module determines whether database submissions
 * are permitted by the Worker's configuration.
 *
 * Never trust a request hostname, Origin, or custom
 * HTTP header to identify the deployment environment.
 */

export interface SubmissionConfig {
	DEPLOYMENT_ENV?: string;
	ENABLE_INCIDENT_SUBMISSIONS?: string;
	TURNSTILE_TEST_MODE?: string;
	TURNSTILE_SECRET_KEY?: string;
}

/**
 * Cloudflare's public Turnstile testing secrets.
 *
 * These must never authorize production submissions.
 */
const TEST_SECRETS = new Set([
	"1x0000000000000000000000000000000AA",
	"2x0000000000000000000000000000000AA",
	"3x0000000000000000000000000000000AA",
]);

export type SubmissionAccess =
	| {
	allowed: true;
	testMode: boolean;
}
	| {
	allowed: false;
	reason: string;
};

/**
 * Verify that the Worker is explicitly configured
 * to accept incident submissions.
 *
 * Missing or unsafe configuration fails closed.
 */
export function checkSubmissionAccess(
	env: SubmissionConfig
): SubmissionAccess {
	if (env.ENABLE_INCIDENT_SUBMISSIONS !== "true") {
		return {
			allowed: false,
			reason: "SUBMISSIONS_DISABLED",
		};
	}

	if (
		env.DEPLOYMENT_ENV !== "development" &&
		env.DEPLOYMENT_ENV !== "production"
	) {
		return {
			allowed: false,
			reason: "INVALID_DEPLOYMENT_ENV",
		};
	}

	const testMode =
		env.TURNSTILE_TEST_MODE === "true";

	const secret = env.TURNSTILE_SECRET_KEY;

	if (!secret) {
		return {
			allowed: false,
			reason: "TURNSTILE_SECRET_MISSING",
		};
	}

	/**
	 * Production requires real credentials.
	 */
	if (env.DEPLOYMENT_ENV === "production") {
		if (testMode || TEST_SECRETS.has(secret)) {
			return {
				allowed: false,
				reason: "TEST_CREDENTIALS_IN_PRODUCTION",
			};
		}

		return {
			allowed: true,
			testMode: false,
		};
	}

	/**
	 * Development requires known testing credentials.
	 */
	if (!testMode || !TEST_SECRETS.has(secret)) {
		return {
			allowed: false,
			reason: "INVALID_DEVELOPMENT_CREDENTIALS",
		};
	}

	return {
		allowed: true,
		testMode: true,
	};
}
