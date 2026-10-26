
/**
 * Server-side Cloudflare Turnstile verification.
 */

interface SiteverifyResponse {
	success: boolean;
	hostname?: string;
	action?: string;
	metadata?: {
		result_with_testing_key?: boolean;
	};
	"error-codes"?: string[];
}

const VERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

const TEST_SECRET =
	"1x0000000000000000000000000000000AA";

const PRODUCTION_HOSTNAMES = new Set([
	"finallynomoreroborio.party",
	"www.finallynomoreroborio.party",
]);

const EXPECTED_ACTION = "submit_incident";

export async function verifyTurnstile(
	token: string,
	secretKey: string,
	testMode = false
): Promise<boolean> {
	if (!token || token.length > 2048 || !secretKey) {
		return false;
	}

	// Keep production credentials separate from test credentials.
	if (testMode && secretKey !== TEST_SECRET) {
		return false;
	}

	if (!testMode && secretKey === TEST_SECRET) {
		return false;
	}

	try {
		const response = await fetch(VERIFY_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				secret: secretKey,
				response: token,
			}),
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			return false;
		}

		const result =
			(await response.json()) as SiteverifyResponse;

		if (result.success !== true) {
			return false;
		}

		/**
		 * Development mode:
		 *
		 * Cloudflare's dummy credentials return a
		 * testing response, which may not contain
		 * the production hostname or action.
		 */
		if (testMode) {
			return (
				result.metadata?.result_with_testing_key === true
			);
		}

		/**
		 * Production mode:
		 *
		 * Require our real domain and specific
		 * incident submission action.
		 */
		return (
			typeof result.hostname === "string" &&
			PRODUCTION_HOSTNAMES.has(result.hostname) &&
			result.action === EXPECTED_ACTION
		);
	} catch (error) {
		console.error(
			"Turnstile verification failed:",
			error
		);

		return false;
	}
}
