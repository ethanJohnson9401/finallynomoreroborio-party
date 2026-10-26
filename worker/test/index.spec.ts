
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

/**
 * Integration tests for the roboRIO Trauma Center API.
 */
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
					"CF-Connecting-IP": "192.0.2.10",
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

	it("rejects incident reports that are too short", async () => {
		const response = await SELF.fetch(
			"http://localhost/api/incidents",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": "192.0.2.11",
				},
				body: JSON.stringify({
					story: "Robot broke.",
					turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
				}),
			}
		);

		expect(response.status).toBe(400);
	});

	it("rejects submissions with the wrong content type", async () => {
		const response = await SELF.fetch(
			"http://localhost/api/incidents",
			{
				method: "POST",
				headers: {
					"Content-Type": "text/plain",
					"CF-Connecting-IP": "192.0.2.12",
				},
				body: "The roboRIO has betrayed us once again.",
			}
		);

		expect(response.status).toBe(415);

		expect(await response.json()).toEqual({
			error: "UNSUPPORTED_MEDIA_TYPE",
		});
	});
});
