CREATE TRIGGER ai_jobs_redact_after_user_acl_change
AFTER UPDATE OF role, is_active ON users
BEGIN
  UPDATE ai_jobs
  SET input_json = '{}',
      result_json = NULL,
      warnings_json = NULL,
      status = CASE
        WHEN status IN ('queued', 'running') THEN 'failed'
        ELSE status
      END,
      error = CASE
        WHEN status IN ('queued', 'running')
          THEN 'AI job processing failed. Submit a new request to retry.'
        ELSE error
      END,
      finished_at = CASE
        WHEN status IN ('queued', 'running')
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        ELSE finished_at
      END,
      worker_id = NULL,
      lease_expires_at = NULL
  WHERE feature = 'harmonize'
    AND user_id = NEW.id
    AND score_id IS NOT NULL
    AND input_json <> '{}'
    AND NOT EXISTS (
      SELECT 1
      FROM scores AS linked_scores
      JOIN users AS linked_users
        ON linked_users.id = ai_jobs.user_id
      WHERE linked_scores.id = ai_jobs.score_id
        AND linked_users.is_active = 1
        AND (
          linked_scores.created_by = linked_users.id
          OR linked_users.role IN ('admin', 'director')
          OR linked_scores.visibility = 'choir'
          OR (
            linked_scores.visibility = 'shared'
            AND EXISTS (
              SELECT 1
              FROM score_access AS linked_access
              WHERE linked_access.score_id = linked_scores.id
                AND linked_access.user_id = linked_users.id
            )
          )
        )
    );
END;
