
import {
	afterEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { verifyTurnstile } from "../src/security/turnstile";

const TEST_SECRET = "1x0000000000000000000000000000000AA";
const PROD_SECRET = "fake-production-secret-for-unit-tests";
const TOKEN = "example-token";

function mockVerification(body: Record<string, unknown>) {
	return vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json(body)
	);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Turnstile verification security", () => {
	it("accepts a valid production verification", async () => {
		const verify = mockVerification({
			success: true,
			hostname: "finallynomoreroborio.party",
			action: "submit_incident",
		});

		expect(
			await verifyTurnstile(TOKEN, PROD_SECRET, false)
		).toBe(true);

		expect(verify).toHaveBeenCalledOnce();
	});

	it("rejects failed verification", async () => {
		mockVerification({
			success: false,
			"error-codes": ["timeout-or-duplicate"],
		});

		expect(
			await verifyTurnstile(TOKEN, PROD_SECRET, false)
		).toBe(false);
	});

	it("rejects an untrusted hostname", async () => {
		mockVerification({
			success: true,
			hostname: "attacker.example",
			action: "submit_incident",
		});

		expect(
			await verifyTurnstile(TOKEN, PROD_SECRET, false)
		).toBe(false);
	});

	it("rejects an incorrect action", async () => {
		mockVerification({
			success: true,
			hostname: "finallynomoreroborio.party",
			action: "some_other_action",
		});

		expect(
			await verifyTurnstile(TOKEN, PROD_SECRET, false)
		).toBe(false);
	});

	it("rejects production use of testing credentials", async () => {
		const verify = vi.spyOn(globalThis, "fetch");

		expect(
			await verifyTurnstile(TOKEN, TEST_SECRET, false)
		).toBe(false);

		expect(verify).not.toHaveBeenCalled();
	});

	it("rejects oversized tokens before making requests", async () => {
		const verify = vi.spyOn(globalThis, "fetch");

		expect(
			await verifyTurnstile("x".repeat(2049), PROD_SECRET, false)
		).toBe(false);

		expect(verify).not.toHaveBeenCalled();
	});

	it("rejects upstream HTTP failures", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("Unavailable", { status: 503 })
		);

		expect(
			await verifyTurnstile(TOKEN, PROD_SECRET, false)
		).toBe(false);
	});

	it("rejects network failures", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("Network unavailable")
		);

		expect(
			await verifyTurnstile(TOKEN, PROD_SECRET, false)
		).toBe(false);
	});

	it("accepts a valid development testing response", async () => {
		mockVerification({
			success: true,
			metadata: {
				result_with_testing_key: true,
			},
		});

		expect(
			await verifyTurnstile(TOKEN, TEST_SECRET, true)
		).toBe(true);
	});
});
