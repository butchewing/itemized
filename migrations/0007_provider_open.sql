-- Drops the CHECK on audits.provider so new providers (claude-sonnet, claude-haiku) can be recorded;
-- the Provider type in src/audit.ts is the list now. SQLite cannot alter a CHECK, so the table is
-- rebuilt: copy every row into a new table, drop the old one, rename. D1 will not drop a table another
-- table references, so reports (audit_id REFERENCES audits) is rebuilt the same way, unchanged, and
-- dropped first. Foreign-key checks wait until the end of the migration.
PRAGMA defer_foreign_keys = true;

CREATE TABLE audits_new (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'extracting', 'checking', 'done', 'failed')),
  provider TEXT NOT NULL,
  doc_key TEXT NOT NULL,
  doc_sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL,
  filename TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  versions TEXT,
  pages TEXT
);

INSERT INTO audits_new (id, status, provider, doc_key, doc_sha256, content_type, filename, error, created_at, updated_at, last_used_at, versions, pages)
  SELECT id, status, provider, doc_key, doc_sha256, content_type, filename, error, created_at, updated_at, last_used_at, versions, pages FROM audits;

-- References audits_new: the rename below rewrites it to audits, so nothing points at the old table.
CREATE TABLE reports_new (
  audit_id TEXT PRIMARY KEY REFERENCES audits_new (id),
  ruleset_version TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO reports_new (audit_id, ruleset_version, json, created_at)
  SELECT audit_id, ruleset_version, json, created_at FROM reports;

DROP TABLE reports;
DROP TABLE audits;
ALTER TABLE audits_new RENAME TO audits;
ALTER TABLE reports_new RENAME TO reports;

CREATE INDEX audits_doc_sha256 ON audits (doc_sha256);
CREATE INDEX audits_doc_provider ON audits (doc_sha256, provider);
