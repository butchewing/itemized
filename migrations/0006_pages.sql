-- Audits of page images: a JSON array of {key, contentType} in page order; doc_key and content_type
-- then describe page 1. NULL for a PDF, and for single images uploaded before this migration.
ALTER TABLE audits ADD COLUMN pages TEXT;
