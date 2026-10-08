CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (username = lower(username)),
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'director', 'member')),
  voice_part TEXT NOT NULL CHECK (voice_part IN ('S', 'A', 'T', 'B', 'none')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  ai_enabled INTEGER NOT NULL DEFAULT 1 CHECK (ai_enabled IN (0, 1)),
  ai_daily_limit INTEGER CHECK (ai_daily_limit IS NULL OR ai_daily_limit >= 0),
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  CHECK ((role = 'member' AND voice_part IN ('S', 'A', 'T', 'B')) OR (role IN ('admin', 'director') AND voice_part = 'none'))
);
CREATE INDEX users_role_idx ON users(role);
CREATE INDEX users_is_active_idx ON users(is_active);

CREATE TABLE scores (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  composer TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'choir', 'shared')),
  current_version_id TEXT REFERENCES score_versions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX scores_created_by_idx ON scores(created_by);
CREATE INDEX scores_visibility_idx ON scores(visibility);

CREATE TABLE score_versions (
  id TEXT PRIMARY KEY NOT NULL,
  score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  musicxml TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX score_versions_score_created_idx ON score_versions(score_id, created_at);

CREATE TABLE score_access (
  score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
  PRIMARY KEY (score_id, user_id)
);

CREATE TABLE ai_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  feature TEXT NOT NULL CHECK (feature IN ('harmonize', 'draft', 'simplify')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input_json TEXT NOT NULL,
  result_json TEXT,
  warnings_json TEXT,
  error TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX ai_jobs_user_created_idx ON ai_jobs(user_id, created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_log_actor_created_idx ON audit_log(actor_id, created_at);
CREATE INDEX audit_log_target_idx ON audit_log(target_type, target_id);
