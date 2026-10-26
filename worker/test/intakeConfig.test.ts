
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../src/index";

const URL = "http://localhost/api/incidents/config";

type WorkerEnv = Parameters<typeof worker.fetch>[1];

function makeEnv(enabled: boolean): WorkerEnv {
	return {
		...env,
		DEPLOYMENT_ENV: "development",
		ENABLE_INCIDENT_SUBMISSIONS:
			enabled ? "true" : "false",
		TURNSTILE_TEST_MODE: "true",
		TURNSTILE_SECRET_KEY:
			"1x0000000000000000000000000000000AA",
	} as WorkerEnv;
}

describe("Public intake configuration", () => {
	it("reports closed when submissions are disabled", async () => {
		const response = await worker.fetch(
			new Request(URL),
			makeEnv(false)
		);

		expect(response.status).toBe(200);

		expect(await response.json()).toEqual({
			submissionsEnabled: false,
		});
	});

	it("reports open for valid enabled configuration", async () => {
		const response = await worker.fetch(
			new Request(URL),
			makeEnv(true)
		);

		expect(response.status).toBe(200);

		expect(await response.json()).toEqual({
			submissionsEnabled: true,
		});
	});

	it("rejects POST requests to the config endpoint", async () => {
		const response = await worker.fetch(
			new Request(URL, { method: "POST" }),
			makeEnv(true)
		);

		expect(response.status).toBe(405);
	});

	it("fails closed with unsafe production credentials", async () => {
		const testEnv = {
			...makeEnv(true),
			DEPLOYMENT_ENV: "production",
		};

		const response = await worker.fetch(
			new Request(URL),
			testEnv
		);

		expect(response.status).toBe(200);

		expect(await response.json()).toEqual({
			submissionsEnabled: false,
		});
	});
});
