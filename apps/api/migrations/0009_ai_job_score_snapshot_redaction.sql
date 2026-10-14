CREATE TRIGGER ai_jobs_redact_linked_snapshots_after_score_delete
AFTER DELETE ON scores
BEGIN
  UPDATE ai_jobs
  SET status = 'failed',
      input_json = '{}',
      result_json = NULL,
      warnings_json = NULL,
      error = 'AI job processing failed. Submit a new request to retry.',
      tokens_in = NULL,
      tokens_out = NULL,
      finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      worker_id = NULL,
      lease_expires_at = NULL
  WHERE score_id = OLD.id;
END;
