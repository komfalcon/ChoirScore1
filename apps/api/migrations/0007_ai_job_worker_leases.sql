ALTER TABLE ai_jobs ADD COLUMN worker_id TEXT;
ALTER TABLE ai_jobs ADD COLUMN lease_expires_at TEXT;
CREATE INDEX ai_jobs_status_lease_idx
  ON ai_jobs(status, lease_expires_at);
