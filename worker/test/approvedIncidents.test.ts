
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";

interface PublicIncident {
	id: string;
	story: string;
	published_at: string;
}

interface ArchiveResponse {
	incidents: PublicIncident[];
	nextCursor: string | null;
}

const ENDPOINT =
	"http://localhost/api/incidents/approved";

async function insertIncident(
	status: "pending" | "approved" | "rejected",
	isTest: boolean,
	publishedAt: string | null
): Promise<string> {
	const id = crypto.randomUUID();

	await env.DB.prepare(`
        INSERT INTO incidents
            (id, story, status, is_test, published_at)
        VALUES (?, ?, ?, ?, ?)
    `)
		.bind(
			id,
			`Test incident ${id}: the roboRIO has disconnected again.`,
			status,
			isTest ? 1 : 0,
			publishedAt
		)
		.run();

	return id;
}

async function cleanup(ids: string[]): Promise<void> {
	for (const id of ids) {
		await env.DB.prepare(
			"DELETE FROM incidents WHERE id = ?"
		)
			.bind(id)
			.run();
	}
}

describe("Public approved incident archive", () => {
	it("exposes only approved, non-test reports", async () => {
		const ids: string[] = [];

		try {
			const approved = await insertIncident(
				"approved",
				false,
				"2026-10-25 12:00:00"
			);
			ids.push(approved);

			ids.push(
				await insertIncident(
					"pending",
					false,
					null
				)
			);

			ids.push(
				await insertIncident(
					"rejected",
					false,
					null
				)
			);

			ids.push(
				await insertIncident(
					"approved",
					true,
					"2026-10-25 13:00:00"
				)
			);

			const response = await SELF.fetch(ENDPOINT);

			expect(response.status).toBe(200);

			const body =
				(await response.json()) as ArchiveResponse;

			const matching = body.incidents.filter(
				(incident) => ids.includes(incident.id)
			);

			expect(matching).toHaveLength(1);
			expect(matching[0].id).toBe(approved);

			expect(
				Object.keys(matching[0]).sort()
			).toEqual([
				"id",
				"published_at",
				"story",
			]);
		} finally {
			await cleanup(ids);
		}
	});

	it("paginates approved reports without duplicates", async () => {
		const ids: string[] = [];

		try {
			ids.push(
				await insertIncident(
					"approved",
					false,
					"2026-10-25 14:00:00"
				)
			);

			ids.push(
				await insertIncident(
					"approved",
					false,
					"2026-10-25 14:00:00"
				)
			);

			const first = await SELF.fetch(
				`${ENDPOINT}?limit=1`
			);

			expect(first.status).toBe(200);

			const firstPage =
				(await first.json()) as ArchiveResponse;

			expect(firstPage.incidents).toHaveLength(1);
			expect(firstPage.nextCursor).toBeTruthy();

			const second = await SELF.fetch(
				`${ENDPOINT}?limit=1&cursor=${encodeURIComponent(
					firstPage.nextCursor!
				)}`
			);

			expect(second.status).toBe(200);

			const secondPage =
				(await second.json()) as ArchiveResponse;

			expect(secondPage.incidents).toHaveLength(1);
			expect(secondPage.nextCursor).toBeNull();

			const returnedIds = [
				firstPage.incidents[0].id,
				secondPage.incidents[0].id,
			];

			expect(new Set(returnedIds).size).toBe(2);
			expect(returnedIds.sort()).toEqual(
				[...ids].sort()
			);
		} finally {
			await cleanup(ids);
		}
	});

	it("rejects invalid pagination parameters", async () => {
		const urls = [
			`${ENDPOINT}?limit=0`,
			`${ENDPOINT}?limit=21`,
			`${ENDPOINT}?limit=abc`,
			`${ENDPOINT}?cursor=invalid`,
		];

		for (const url of urls) {
			const response = await SELF.fetch(url);

			expect(response.status).toBe(400);
		}
	});

	it("does not allow public archive mutations", async () => {
		const response = await SELF.fetch(ENDPOINT, {
			method: "POST",
		});

		expect(response.status).toBe(405);
	});
});
