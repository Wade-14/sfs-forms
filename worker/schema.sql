-- SFS Forms storage. Only incident reports are kept online (until a manager finishes the investigation).
CREATE TABLE IF NOT EXISTS incidents (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'open',   -- 'open' (awaiting investigation) or 'complete'
  reported_by    TEXT NOT NULL DEFAULT '',
  summary        TEXT NOT NULL DEFAULT '',
  report         TEXT NOT NULL,                  -- JSON: the employee's answers + signature
  investigation  TEXT NOT NULL DEFAULT '{}',     -- JSON: the manager's answers + signature
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT
);
CREATE INDEX IF NOT EXISTS incidents_status ON incidents(status, created_at);

-- Managers' phones that asked for incident alerts (Web Push subscriptions).
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint    TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);
