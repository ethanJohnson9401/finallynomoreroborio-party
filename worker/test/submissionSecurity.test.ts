
import {
	afterEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { env } from "cloudflare:workers";
import worker from "../src/index";

type WorkerEnv = Parameters<typeof worker.fetch>[1];

const ENDPOINT = "http://localhost/api/incidents";

const TEST_SECRET =
	"1x0000000000000000000000000000000AA";

const VALID_STORY =
	"Our roboRIO disconnected during autonomous and ruined the entire match.";

const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

function makeEnv(
	limiter?: {
		limit(options: { key: string }): Promise<{ success: boolean }>;
	}
): WorkerEnv {
	return {
		...env,
		DEPLOYMENT_ENV: "development",
		ENABLE_INCIDENT_SUBMISSIONS: "true",
		TURNSTILE_TEST_MODE: "true",
		TURNSTILE_SECRET_KEY: TEST_SECRET,
		...(limiter ? { INCIDENT_LIMITER: limiter } : {}),
	} as WorkerEnv;
}

function makeRequest(
	body: unknown,
	options: {
		origin?: string;
		contentType?: string;
		rawBody?: string;
	} = {}
): Request {
	const headers = new Headers({
		"Content-Type": options.contentType ?? "application/json",
		"CF-Connecting-IP": "192.0.2.240",
	});

	if (options.origin) {
		headers.set("Origin", options.origin);
	}

	return new Request(ENDPOINT, {
		method: "POST",
		headers,
		body: options.rawBody ?? JSON.stringify(body),
	});
}

function validBody() {
	return {
		story: VALID_STORY,
		turnstileToken: TEST_TOKEN,
		submissionKey: crypto.randomUUID(),
	};
}

function permitLimiter() {
	return {
		limit: vi.fn(async () => ({ success: true })),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Incident submission security", () => {
	it("rejects malformed JSON with HTTP 400", async () => {
		const response = await worker.fetch(
			makeRequest(null, { rawBody: "{broken json" }),
			makeEnv()
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "INVALID_JSON",
		});
	});

	it("rejects unsupported media types with HTTP 415", async () => {
		const response = await worker.fetch(
			makeRequest(validBody(), {
				contentType: "text/plain",
			}),
			makeEnv()
		);

		expect(response.status).toBe(415);
		expect(await response.json()).toEqual({
			error: "UNSUPPORTED_MEDIA_TYPE",
		});
	});

	it("rejects oversized requests with HTTP 413", async () => {
		const response = await worker.fetch(
			makeRequest({
				...validBody(),
				extra: "x".repeat(9000),
			}),
			makeEnv()
		);

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: "REQUEST_TOO_LARGE",
		});
	});

	it.each([
		["short", "Too short"],
		["long", "x".repeat(1001)],
		["whitespace", " ".repeat(50)],
	])("rejects a %s story", async (_label, story) => {
		const response = await worker.fetch(
			makeRequest({
				...validBody(),
				story,
			}),
			makeEnv()
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "INVALID_STORY_LENGTH",
		});
	});

	it("rejects a missing story", async () => {
		const response = await worker.fetch(
			makeRequest({
				turnstileToken: TEST_TOKEN,
			}),
			makeEnv()
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "INVALID_STORY",
		});
	});

	it("requires a Turnstile token", async () => {
		const response = await worker.fetch(
			makeRequest({
				story: VALID_STORY,
			}),
			makeEnv()
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "TURNSTILE_TOKEN_REQUIRED",
		});
	});

	it("rejects untrusted origins with HTTP 403", async () => {
		const response = await worker.fetch(
			makeRequest(validBody(), {
				origin: "https://attacker.example",
			}),
			makeEnv()
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "ORIGIN_NOT_ALLOWED",
		});
	});

	it("returns HTTP 429 when rate limited", async () => {
		const limiter = {
			limit: vi.fn(async () => ({
				success: false,
			})),
		};

		const response = await worker.fetch(
			makeRequest(validBody()),
			makeEnv(limiter)
		);

		expect(response.status).toBe(429);
		expect(await response.json()).toEqual({
			error: "RATE_LIMITED",
		});
		expect(limiter.limit).toHaveBeenCalledOnce();
	});

	it("fails closed when rate limiting is unavailable", async () => {
		const limiter = {
			limit: vi.fn(async (): Promise<{ success: boolean }> => {
				throw new Error("SIMULATED_LIMITER_FAILURE");
			}),
		};

		const response = await worker.fetch(
			makeRequest(validBody()),
			makeEnv(limiter)
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: "RATE_LIMIT_UNAVAILABLE",
		});
	});

	it("rejects failed Turnstile verification", async () => {
		const siteverify = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				Response.json({
					success: false,
					"error-codes": ["timeout-or-duplicate"],
				})
			);

		const response = await worker.fetch(
			makeRequest(validBody()),
			makeEnv(permitLimiter())
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "TURNSTILE_VERIFICATION_FAILED",
		});

		expect(siteverify).toHaveBeenCalledOnce();
	});

	it("never stores rejected requests", async () => {
		const testEnv = makeEnv();

		const before = await testEnv.DB
			.prepare("SELECT COUNT(*) AS total FROM incidents")
			.first<{ total: number }>();

		const response = await worker.fetch(
			makeRequest({
				story: "Invalid",
				turnstileToken: TEST_TOKEN,
			}),
			testEnv
		);

		expect(response.status).toBe(400);

		const after = await testEnv.DB
			.prepare("SELECT COUNT(*) AS total FROM incidents")
			.first<{ total: number }>();

		expect(after?.total).toBe(before?.total);
	});
});
