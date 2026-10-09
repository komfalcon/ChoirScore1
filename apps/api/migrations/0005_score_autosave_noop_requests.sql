CREATE TABLE score_autosave_noop_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  base_version_id TEXT NOT NULL,
  musicxml_hash TEXT NOT NULL CHECK (length(musicxml_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (score_id, actor_id, request_id)
);
CREATE INDEX score_autosave_noop_retention_idx
  ON score_autosave_noop_requests(score_id, id);
