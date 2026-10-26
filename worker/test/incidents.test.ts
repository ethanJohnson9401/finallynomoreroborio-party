
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import {
	countIncidents,
	createIncident,
} from "../src/db/incidents";

describe("Incident database operations", () => {
	it("creates an incident with pending status", async () => {
		const story =
			"The roboRIO disconnected during autonomous and ruined our match.";

		const initialCount = await countIncidents(env.DB);

		const result = await createIncident(env.DB, story);

		try {
			expect(result.id).toBeTruthy();
			expect(result.status).toBe("pending");

			const incident = await env.DB
				.prepare(
					"SELECT id, story, status FROM incidents WHERE id = ?"
				)
				.bind(result.id)
				.first<{
					id: string;
					story: string;
					status: string;
				}>();

			expect(incident).not.toBeNull();
			expect(incident?.id).toBe(result.id);
			expect(incident?.story).toBe(story);
			expect(incident?.status).toBe("pending");

			const updatedCount = await countIncidents(env.DB);

			expect(updatedCount).toBe(initialCount + 1);
		} finally {
			await env.DB
				.prepare("DELETE FROM incidents WHERE id = ?")
				.bind(result.id)
				.run();
		}
	});
});
