
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("roboRIO Trauma Center API", () => {
	it("returns a successful health check", async () => {
		const response = await SELF.fetch(
			"http://localhost/api/health"
		);

		expect(response.status).toBe(200);

		expect(await response.json()).toEqual({
			status: "ok",
			service: "roborio-trauma-api",
		});
	});

	it("returns 404 for unknown endpoints", async () => {
		const response = await SELF.fetch(
			"http://localhost/does-not-exist"
		);

		expect(response.status).toBe(404);

		expect(await response.json()).toEqual({
			error: "NOT_FOUND",
		});
	});

	it("rejects incident submissions without Turnstile", async () => {
		const response = await SELF.fetch(
			"http://localhost/api/incidents",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					story:
						"Our roboRIO disconnected during an elimination match.",
				}),
			}
		);

		expect(response.status).toBe(400);

		expect(await response.json()).toEqual({
			error: "TURNSTILE_TOKEN_REQUIRED",
		});
	});
});
