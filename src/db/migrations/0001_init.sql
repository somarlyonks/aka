CREATE TABLE IF NOT EXISTS aliases (
  word             TEXT PRIMARY KEY,
  content          TEXT NOT NULL,
  secret           TEXT,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER              -- NULL = never expires (built-ins only)
);
