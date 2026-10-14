-- Intentionally do not add a foreign key: queued jobs must retain the source ID
-- after deletion so the worker can reject them before any provider call.
ALTER TABLE ai_jobs ADD COLUMN score_id TEXT;
CREATE INDEX ai_jobs_score_idx ON ai_jobs(score_id);
