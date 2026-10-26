
import {
	describe,
	expect,
	it,
	vi,
} from "vitest";

import {
	checkIncidentRateLimit,
} from "../src/security/rateLimit";

type RateLimitBinding = Parameters<
	typeof checkIncidentRateLimit
>[0];

const ENDPOINT =
	"https://api.finallynomoreroborio.party/api/incidents";

/**
 * Construct a request with an optional client IP.
 */
function makeRequest(ip?: string): Request {
	const headers = new Headers();

	if (ip !== undefined) {
		headers.set("CF-Connecting-IP", ip);
	}

	return new Request(ENDPOINT, {
		method: "POST",
		headers,
	});
}

/**
 * Create a mock rate limiter.
 */
function makeLimiter(
	implementation: (key: string) => boolean
): RateLimitBinding {
	return {
		limit: vi.fn(async ({ key }) => ({
			success: implementation(key),
		})),
	};
}

describe("Incident rate limiting", () => {
	it("allows a request when Cloudflare permits it", async () => {
		const limiter = makeLimiter(() => true);

		const allowed = await checkIncidentRateLimit(
			limiter,
			makeRequest("192.0.2.10")
		);

		expect(allowed).toBe(true);

		expect(limiter.limit).toHaveBeenCalledWith({
			key: "192.0.2.10",
		});
	});

	it("rejects a request when Cloudflare denies it", async () => {
		const limiter = makeLimiter(() => false);

		const allowed = await checkIncidentRateLimit(
			limiter,
			makeRequest("192.0.2.11")
		);

		expect(allowed).toBe(false);
	});

	it("rejects requests missing CF-Connecting-IP", async () => {
		const limiter = makeLimiter(() => true);

		const allowed = await checkIncidentRateLimit(
			limiter,
			makeRequest()
		);

		expect(allowed).toBe(false);

		expect(limiter.limit).not.toHaveBeenCalled();
	});

	it("uses distinct keys for different IP addresses", async () => {
		const observedKeys: string[] = [];

		const limiter = makeLimiter((key) => {
			observedKeys.push(key);
			return true;
		});

		await checkIncidentRateLimit(
			limiter,
			makeRequest("192.0.2.20")
		);

		await checkIncidentRateLimit(
			limiter,
			makeRequest("192.0.2.21")
		);

		expect(observedKeys).toEqual([
			"192.0.2.20",
			"192.0.2.21",
		]);
	});

	it("rejects the sixth request in a simulated 5-request quota", async () => {
		const counts = new Map<string, number>();

		const limiter = makeLimiter((key) => {
			const count = (counts.get(key) ?? 0) + 1;

			counts.set(key, count);

			return count <= 5;
		});

		const results: boolean[] = [];

		for (let i = 0; i < 6; i++) {
			results.push(
				await checkIncidentRateLimit(
					limiter,
					makeRequest("192.0.2.30")
				)
			);
		}

		expect(results).toEqual([
			true,
			true,
			true,
			true,
			true,
			false,
		]);
	});

	it("does not allow one IP to consume another IP's simulated quota", async () => {
		const counts = new Map<string, number>();

		const limiter = makeLimiter((key) => {
			const count = (counts.get(key) ?? 0) + 1;

			counts.set(key, count);

			return count <= 5;
		});

		for (let i = 0; i < 5; i++) {
			expect(
				await checkIncidentRateLimit(
					limiter,
					makeRequest("192.0.2.40")
				)
			).toBe(true);
		}

		expect(
			await checkIncidentRateLimit(
				limiter,
				makeRequest("192.0.2.40")
			)
		).toBe(false);

		expect(
			await checkIncidentRateLimit(
				limiter,
				makeRequest("192.0.2.41")
			)
		).toBe(true);
	});

	it("propagates binding failures so the caller can fail closed", async () => {
		const limiter: RateLimitBinding = {
			limit: vi.fn(async () => {
				throw new Error("RATE_LIMIT_SERVICE_DOWN");
			}),
		};

		await expect(
			checkIncidentRateLimit(
				limiter,
				makeRequest("192.0.2.50")
			)
		).rejects.toThrow("RATE_LIMIT_SERVICE_DOWN");
	});
});
