CREATE TABLE reports (
  audit_id TEXT PRIMARY KEY REFERENCES audits (id),
  ruleset_version TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
