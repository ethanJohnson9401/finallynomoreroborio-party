
-- Migration 0005
-- Support withdrawing approved reports from publication.
-- This does not permanently delete incident content.

ALTER TABLE incidents
	ADD COLUMN withdrawn_at TEXT;

-- A withdrawal can happen once per incident.
-- Moderator identity is preserved for accountability.
CREATE TABLE IF NOT EXISTS incident_withdrawal_audit (
														 id TEXT PRIMARY KEY,

	                                                     incident_id TEXT NOT NULL UNIQUE,

	                                                     moderator_email TEXT NOT NULL,

	                                                     reason TEXT NOT NULL
	                                                     CHECK (length(trim(reason)) BETWEEN 10 AND 500),

	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

	FOREIGN KEY (incident_id)
	REFERENCES incidents(id)
	);

CREATE INDEX IF NOT EXISTS
	idx_incident_withdrawal_audit_created
	ON incident_withdrawal_audit (created_at DESC);
