
import {
	describe,
	expect,
	it,
} from "vitest";

import { env } from "cloudflare:workers";
import worker from "../src/index";

const URL =
	"http://localhost/api/admin/incidents";

type WorkerEnv =
	Parameters<typeof worker.fetch>[1];

type WorkerContext =
	Parameters<typeof worker.fetch>[2];

const testEnv = {
	...env,
	MODERATOR_EMAILS: "admin@example.com",
} as WorkerEnv;

/**
 * Construct a simulated Access-authenticated context.
 *
 * Only for integration testing:
 * real authentication must come from Cloudflare Access.
 */
function contextWithEmail(
	email: string
): WorkerContext {
	return {
		access: {
			getIdentity: async () => ({ email }),
		},
	} as unknown as WorkerContext;
}

describe("Admin incidents API", () => {
	it("rejects unauthenticated requests", async () => {
		const response = await worker.fetch(
			new Request(URL),
			testEnv,
			{} as WorkerContext
		);

		expect(response.status).toBe(401);

		expect(await response.json()).toEqual({
			error: "UNAUTHENTICATED",
		});
	});

	it("rejects a user who is not a moderator", async () => {
		const response = await worker.fetch(
			new Request(URL),
			testEnv,
			contextWithEmail("visitor@example.com")
		);

		expect(response.status).toBe(403);

		expect(await response.json()).toEqual({
			error: "FORBIDDEN",
		});
	});

	it("allows a moderator to read pending incidents", async () => {
		const response = await worker.fetch(
			new Request(URL),
			testEnv,
			contextWithEmail("admin@example.com")
		);

		expect(response.status).toBe(200);

		const result = (await response.json()) as {
			status: string;
			count: number;
			incidents: Array<{
				id: string;
				story: string;
				status: string;
				created_at: string;
			}>;
		};

		expect(result.status).toBe("ok");
		expect(result.count).toBe(result.incidents.length);

		for (const incident of result.incidents) {
			expect(incident.status).toBe("pending");
			expect(typeof incident.story).toBe("string");
		}
	});

	it("rejects unsupported HTTP methods", async () => {
		const response = await worker.fetch(
			new Request(URL, {
				method: "POST",
			}),
			testEnv,
			contextWithEmail("admin@example.com")
		);

		expect(response.status).toBe(405);
	});

	it("does not trust a forged identity header", async () => {
		const response = await worker.fetch(
			new Request(URL, {
				headers: {
					"CF-Access-Authenticated-User-Email":
						"admin@example.com",
				},
			}),
			testEnv,
			{} as WorkerContext
		);

		expect(response.status).toBe(401);
	});
});
