
/**
 * Incident submission rate limiting.
 */

interface RateLimitBinding {
	limit(options: {
		key: string;
	}): Promise<{
		success: boolean;
	}>;
}

export async function checkIncidentRateLimit(
	limiter: RateLimitBinding,
	request: Request
): Promise<boolean> {
	const clientIp = request.headers.get("CF-Connecting-IP");

	if (!clientIp) {
		return false;
	}

	const result = await limiter.limit({
		key: clientIp,
	});

	return result.success;
}
