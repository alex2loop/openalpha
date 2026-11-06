-- One row per published day, kept for good: the history is the Worker's, not the daemon's.
CREATE TABLE briefs (
  day TEXT PRIMARY KEY,
  schema INTEGER NOT NULL,
  body TEXT NOT NULL,
  published_at INTEGER NOT NULL
);
