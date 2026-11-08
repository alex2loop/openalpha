-- A brief's push is claimed once, by stamping the day. One row per phone, the push address and how
-- many pushes in a row failed; the row holds no language and no payload.
ALTER TABLE briefs ADD COLUMN pushed_at INTEGER;

CREATE TABLE subscriptions (
  endpoint TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0
);
