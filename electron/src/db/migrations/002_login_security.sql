-- Migration 002: sign-in attempt tracking for rate limiting (no passwords stored)

CREATE TABLE IF NOT EXISTS login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username_key TEXT NOT NULL,
  succeeded    INTEGER NOT NULL DEFAULT 0 CHECK (succeeded IN (0, 1)),
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_key_time ON login_attempts(username_key, attempted_at);
