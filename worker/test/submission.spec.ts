
import {
	afterEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { env } from "cloudflare:workers";
import worker from "../src/index";

const ENDPOINT = "http://localhost/api/incidents";

const TEST_SECRET =
	"1x0000000000000000000000000000000AA";

const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

const STORY =
	"Our roboRIO disconnected during the final match and decided that autonomous was optional.";

/**
 * Construct an isolated Worker test environment.
 */
function makeTestEnv(submissionsEnabled: boolean) {
	return {
		...env,

		DEPLOYMENT_ENV: "development",

		TURNSTILE_SECRET_KEY: TEST_SECRET,
		TURNSTILE_TEST_MODE: "true",

		ENABLE_INCIDENT_SUBMISSIONS:
			submissionsEnabled ? "true" : "false",
	} as Parameters<typeof worker.fetch>[1];
}

/**
 * Mock a successful Cloudflare Turnstile response.
 */
function mockTurnstileSuccess() {
	return vi.spyOn(
		globalThis,
		"fetch"
	).mockResolvedValue(
		Response.json({
			success: true,
			hostname: "example.com",
			"error-codes": [],
			metadata: {
				result_with_testing_key: true,
			},
		})
	);
}

/**
 * Construct a valid incident submission.
 */
function makeSubmissionRequest(ip: string) {
	return new Request(ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": ip,
		},
		body: JSON.stringify({
			story: STORY,
			turnstileToken: TEST_TOKEN,
		}),
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Incident submission integration", () => {
	it("creates a pending incident and returns HTTP 201", async () => {
		const siteverify = mockTurnstileSuccess();

		const testEnv = makeTestEnv(true);

		const response = await worker.fetch(
			makeSubmissionRequest("192.0.2.201"),
			testEnv
		);

		expect(response.status).toBe(201);

		const receipt = (await response.json()) as {
			status: string;
			id: string;
			moderation: string;
			message: string;
		};

		expect(receipt.status).toBe("received");
		expect(receipt.moderation).toBe("pending");

		expect(receipt.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4,12}$/i
		);

		expect(siteverify).toHaveBeenCalledOnce();

		/**
		 * Verify the record exists in D1.
		 */
		const savedIncident = await testEnv.DB
			.prepare(
				`SELECT id, story, status
				 FROM incidents
				 WHERE id = ?`
			)
			.bind(receipt.id)
			.first<{
				id: string;
				story: string;
				status: string;
			}>();

		expect(savedIncident).toEqual({
			id: receipt.id,
			story: STORY,
			status: "pending",
		});

		/**
		 * Clean up this test's incident.
		 */
		await testEnv.DB
			.prepare(
				"DELETE FROM incidents WHERE id = ?"
			)
			.bind(receipt.id)
			.run();
	});

	it("prevents storage when submissions are disabled", async () => {
		const siteverify = mockTurnstileSuccess();

		const testEnv = makeTestEnv(false);

		const before = await testEnv.DB
			.prepare(
				"SELECT COUNT(*) AS total FROM incidents"
			)
			.first<{ total: number }>();

		const response = await worker.fetch(
			makeSubmissionRequest("192.0.2.202"),
			testEnv
		);

		expect(response.status).toBe(503);

		expect(await response.json()).toEqual({
			error: "SUBMISSIONS_DISABLED",
		});

		/**
		 * Disabled submissions must not make
		 * an external verification request.
		 */
		expect(siteverify).not.toHaveBeenCalled();

		const after = await testEnv.DB
			.prepare(
				"SELECT COUNT(*) AS total FROM incidents"
			)
			.first<{ total: number }>();

		expect(after?.total).toBe(before?.total);
	});
});
