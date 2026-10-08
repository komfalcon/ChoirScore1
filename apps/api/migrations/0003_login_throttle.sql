CREATE TABLE login_throttle (
  pair_key TEXT PRIMARY KEY NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 5),
  locked_until INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_throttle_expires_idx ON login_throttle(expires_at);
