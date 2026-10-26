
import { afterEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";

const env = workerEnv as typeof workerEnv & {
    DB: D1Database;
};

import {
    getPendingIncidentPage,
} from "../src/db/incidents";

const createdIds: string[] = [];

async function insertIncident(
    createdAt: string
): Promise<string> {
    const id = crypto.randomUUID();

    await env.DB.prepare(`
        INSERT INTO incidents (
            id,
            story,
            status,
            created_at
        )
        VALUES (?, ?, 'pending', ?)
    `)
        .bind(
            id,
            `Pagination test incident ${id}`,
            createdAt
        )
        .run();

    createdIds.push(id);

    return id;
}

afterEach(async () => {
    for (const id of createdIds) {
        await env.DB.prepare(
            "DELETE FROM incidents WHERE id = ?"
        )
            .bind(id)
            .run();
    }

    createdIds.length = 0;
});

describe("Moderation queue pagination", () => {
    it("returns pending reports with an accurate total", async () => {
        const ids = [
            await insertIncident("2026-10-26 08:00:00"),
            await insertIncident("2026-10-26 08:01:00"),
            await insertIncident("2026-10-26 08:02:00"),
        ];

        const page = await getPendingIncidentPage(
            env.DB,
            null,
            2
        );

        expect(page.total).toBe(3);
        expect(page.incidents).toHaveLength(2);
        expect(page.nextCursor).not.toBeNull();

        expect(
            page.incidents.map((incident) => incident.id)
        ).toEqual([ids[2], ids[1]]);
    });

    it("retrieves all pending records without duplicates", async () => {
        const ids: string[] = [];

        for (let index = 0; index < 7; index++) {
            ids.push(
                await insertIncident(
                    `2026-10-26 09:${String(index).padStart(2, "0")}:00`
                )
            );
        }

        let cursor: string | null = null;
        const loadedIds: string[] = [];

        do {
            const page: Awaited<
                ReturnType<typeof getPendingIncidentPage>
            > = await getPendingIncidentPage(
                env.DB,
                cursor,
                3
            );

            loadedIds.push(
                ...page.incidents.map((incident) => incident.id)
            );

            cursor = page.nextCursor;
        } while (cursor);

        expect(loadedIds).toHaveLength(7);
        expect(new Set(loadedIds).size).toBe(7);
        expect(loadedIds.sort()).toEqual(ids.sort());
    });

    it("rejects malformed cursors", async () => {
        await expect(
            getPendingIncidentPage(
                env.DB,
                "not-a-valid-cursor"
            )
        ).rejects.toThrow("INVALID_CURSOR");
    });

    it("rejects invalid page sizes", async () => {
        await expect(
            getPendingIncidentPage(env.DB, null, 0)
        ).rejects.toThrow("INVALID_LIMIT");

        await expect(
            getPendingIncidentPage(env.DB, null, 51)
        ).rejects.toThrow("INVALID_LIMIT");
    });
});
