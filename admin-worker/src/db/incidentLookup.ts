
export interface ModeratorIncident {
    id: string;
    story: string;
    status: "pending" | "approved" | "rejected";
    created_at: string;
    reviewed_at: string | null;
    published_at: string | null;
    withdrawn_at: string | null;
}

export async function findIncidentForModerator(
    db: D1Database,
    id: string
): Promise<ModeratorIncident | null> {
    return db
        .prepare(
            `SELECT
                 id,
                 story,
                 status,
                 created_at,
                 reviewed_at,
                 published_at,
                 withdrawn_at
             FROM incidents
             WHERE id = ?`
        )
        .bind(id)
        .first<ModeratorIncident>();
}
