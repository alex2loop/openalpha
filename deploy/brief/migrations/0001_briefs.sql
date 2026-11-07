-- One row per published day; every insert prunes the rows past 30 days.
CREATE TABLE briefs (
  day TEXT PRIMARY KEY,
  schema INTEGER NOT NULL,
  body TEXT NOT NULL,
  published_at INTEGER NOT NULL
);
