
-- roboRIO Trauma Center
-- Migration 0002: Moderation audit logging
--
-- Records individual moderator decisions.
-- No existing incidents are modified.

CREATE TABLE IF NOT EXISTS moderation_audit (
                                                id TEXT PRIMARY KEY,

                                                incident_id TEXT NOT NULL,

                                                moderator_email TEXT NOT NULL,

                                                action TEXT NOT NULL
                                                CHECK (action IN ('approved', 'rejected')),

    previous_status TEXT NOT NULL
    CHECK (previous_status = 'pending'),

    new_status TEXT NOT NULL
    CHECK (new_status IN ('approved', 'rejected')),

    created_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (incident_id)
    REFERENCES incidents(id)
    );

CREATE INDEX IF NOT EXISTS idx_moderation_audit_incident
    ON moderation_audit (incident_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_audit_created
    ON moderation_audit (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_audit_one_decision
    ON moderation_audit (incident_id);
