CREATE TABLE audits (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'extracting', 'checking', 'done', 'failed')),
  provider TEXT NOT NULL CHECK (provider IN ('meta-api', 'open-weights')),
  doc_key TEXT NOT NULL,
  doc_sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL,
  filename TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX audits_doc_sha256 ON audits (doc_sha256);
