-- Migration number: 0001 	 2026-10-26T00:52:47.738Z

CREATE TABLE IF NOT EXISTS incidents (
										 id TEXT PRIMARY KEY,

	                                     story TEXT NOT NULL
	                                     CHECK (length(trim(story)) BETWEEN 20 AND 1000),

	status TEXT NOT NULL DEFAULT 'pending'
	CHECK (status IN ('pending', 'approved', 'rejected')),

	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	reviewed_at TEXT,
	published_at TEXT
	);

CREATE INDEX IF NOT EXISTS idx_incidents_status_created
ON incidents (status, created_at DESC);
