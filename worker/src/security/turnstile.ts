
/**
 * Verify Cloudflare Turnstile tokens on the server.
 */

interface TurnstileResult {
	success: boolean;
	hostname?: string;
	action?: string;
	"error-codes"?: string[];
}

export async function verifyTurnstile(
	token: string,
	secretKey: string
): Promise<boolean> {
	if (!token || token.length > 2048 || !secretKey) {
		return false;
	}

	try {
		const response = await fetch(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					secret: secretKey,
					response: token,
				}),
			}
		);

		if (!response.ok) {
			return false;
		}

		const result =
			(await response.json()) as TurnstileResult;

		return result.success === true;
	} catch (error) {
		console.error("Turnstile verification error:", error);
		return false;
	}
}
