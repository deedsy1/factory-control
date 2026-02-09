-- v1: durable queue + job history

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  repo TEXT NOT NULL,
  site_name TEXT,
  event_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  pages INTEGER NOT NULL,
  template TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL, -- queued|running|success|failed|canceled
  priority INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,

  locked_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,

  gh_run_url TEXT,
  gh_run_id INTEGER,
  gh_conclusion TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_repo_status ON jobs(repo, status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

-- per-repo lock (prevents overlapping runs)
CREATE TABLE IF NOT EXISTS site_locks (
  repo TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  locked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_locks_locked_at ON site_locks(locked_at);
