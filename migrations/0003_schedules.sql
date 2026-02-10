CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  site_name TEXT NOT NULL,
  repo TEXT NOT NULL,
  cadence TEXT NOT NULL,
  hour_utc INTEGER,
  minute_utc INTEGER NOT NULL DEFAULT 0,
  pages INTEGER NOT NULL,
  mode TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next
  ON schedules(enabled, next_run_at);

CREATE INDEX IF NOT EXISTS idx_schedules_repo
  ON schedules(repo);