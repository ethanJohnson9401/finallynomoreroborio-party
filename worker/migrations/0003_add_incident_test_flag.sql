
-- Migration 0003
-- Keep synthetic test incidents out of the public archive.

ALTER TABLE incidents
	ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0
		CHECK (is_test IN (0, 1));

-- Optimize retrieval of approved public reports.
CREATE INDEX IF NOT EXISTS idx_incidents_publication
	ON incidents (published_at DESC, id DESC)
	WHERE status = 'approved'
	AND is_test = 0
	AND published_at IS NOT NULL;
