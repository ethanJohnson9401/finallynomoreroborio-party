
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
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const STORY = "The roboRIO lost communications just before our final match.";

function makeEnv(enabled = true): WorkerEnv {
	return {
		...env,
		DEPLOYMENT_ENV: "development",
		ENABLE_INCIDENT_SUBMISSIONS: enabled ? "true" : "false",
		TURNSTILE_TEST_MODE: "true",
		TURNSTILE_SECRET_KEY: TEST_SECRET,
		INCIDENT_LIMITER: {
			limit: async () => ({ success: true }),
		},
	} as WorkerEnv;
}

function makeRequest(key: string, story = STORY): Request {
	return new Request(ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": "192.0.2.251",
		},
		body: JSON.stringify({
			story,
			turnstileToken: TEST_TOKEN,
			submissionKey: key,
		}),
	});
}

function mockTurnstileSuccess() {
	return vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async () =>
			Response.json({
				success: true,
				metadata: {
					result_with_testing_key: true,
				},
			})
		);
}

async function removeByKey(db: D1Database, key: string) {
	await db
		.prepare("DELETE FROM incidents WHERE submission_key = ?")
		.bind(key)
		.run();
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Idempotent incident submissions", () => {
	it("returns the same receipt for an identical retry", async () => {
		mockTurnstileSuccess();
		const testEnv = makeEnv();
		const key = crypto.randomUUID();

		try {
			const first = await worker.fetch(makeRequest(key), testEnv);
			const second = await worker.fetch(makeRequest(key), testEnv);

			expect(first.status).toBe(201);
			expect(second.status).toBe(200);

			const firstReceipt = await first.json() as { id: string };
			const secondReceipt = await second.json() as { id: string };

			expect(secondReceipt.id).toBe(firstReceipt.id);

			const result = await testEnv.DB
				.prepare(
					"SELECT COUNT(*) AS total FROM incidents WHERE submission_key = ?"
				)
				.bind(key)
				.first<{ total: number }>();

			expect(result?.total).toBe(1);
		} finally {
			await removeByKey(testEnv.DB, key);
		}
	});

	it("rejects a reused key with different content", async () => {
		mockTurnstileSuccess();
		const testEnv = makeEnv();
		const key = crypto.randomUUID();

		try {
			const first = await worker.fetch(makeRequest(key), testEnv);
			const second = await worker.fetch(
				makeRequest(key, "A completely different roboRIO incident occurred."),
				testEnv
			);

			expect(first.status).toBe(201);
			expect(second.status).toBe(409);
			expect(await second.json()).toEqual({
				error: "SUBMISSION_KEY_CONFLICT",
			});
		} finally {
			await removeByKey(testEnv.DB, key);
		}
	});

	it("prevents duplicates from concurrent requests", async () => {
		mockTurnstileSuccess();
		const testEnv = makeEnv();
		const key = crypto.randomUUID();

		try {
			const [first, second] = await Promise.all([
				worker.fetch(makeRequest(key), testEnv),
				worker.fetch(makeRequest(key), testEnv),
			]);

			expect([first.status, second.status].sort()).toEqual([200, 201]);

			const count = await testEnv.DB
				.prepare(
					"SELECT COUNT(*) AS total FROM incidents WHERE submission_key = ?"
				)
				.bind(key)
				.first<{ total: number }>();

			expect(count?.total).toBe(1);
		} finally {
			await removeByKey(testEnv.DB, key);
		}
	});

	it("does not replay when the kill switch is disabled", async () => {
		mockTurnstileSuccess();
		const enabledEnv = makeEnv(true);
		const disabledEnv = makeEnv(false);
		const key = crypto.randomUUID();

		try {
			expect(
				(await worker.fetch(makeRequest(key), enabledEnv)).status
			).toBe(201);

			const replay = await worker.fetch(
				makeRequest(key),
				disabledEnv
			);

			expect(replay.status).toBe(503);
		} finally {
			await removeByKey(enabledEnv.DB, key);
		}
	});

	it("does not replay after Turnstile rejection", async () => {
		const verify = vi.spyOn(globalThis, "fetch");
		const testEnv = makeEnv();
		const key = crypto.randomUUID();

		try {
			verify.mockResolvedValueOnce(
				Response.json({
					success: true,
					metadata: {
						result_with_testing_key: true,
					},
				})
			);

			verify.mockResolvedValueOnce(
				Response.json({ success: false })
			);

			const first = await worker.fetch(makeRequest(key), testEnv);
			const second = await worker.fetch(makeRequest(key), testEnv);

			expect(first.status).toBe(201);
			expect(second.status).toBe(403);
		} finally {
			await removeByKey(testEnv.DB, key);
		}
	});
});
