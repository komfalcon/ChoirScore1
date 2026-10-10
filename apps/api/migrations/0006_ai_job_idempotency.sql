ALTER TABLE ai_jobs ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX ai_jobs_user_request_unique
  ON ai_jobs(user_id, request_id)
  WHERE request_id IS NOT NULL;
