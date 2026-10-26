-- versions stays NULL for existing rows: their reports came from earlier pipeline versions
-- (some ran before semantic checks existed), so they are never reused.
ALTER TABLE audits ADD COLUMN last_used_at TEXT;
ALTER TABLE audits ADD COLUMN versions TEXT;
UPDATE audits SET last_used_at = created_at;
CREATE INDEX audits_doc_provider ON audits (doc_sha256, provider);
