CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT,
  data_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_ts
  ON job_events(job_id, ts);