
-- Migration 0004
-- Prevent duplicate incident creation when a submission is retried.
--
-- Existing incidents retain a NULL submission key.
-- New API submissions will provide a UUID idempotency key.

ALTER TABLE incidents
	ADD COLUMN submission_key TEXT;

-- SQLite permits multiple NULL values in a UNIQUE index,
-- so legacy reports remain valid.
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_submission_key
	ON incidents (submission_key)
	WHERE submission_key IS NOT NULL;
