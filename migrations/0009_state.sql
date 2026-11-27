-- The state the uploader said the funeral home is in (USPS code), or NULL to use the list's address.
-- Same document, different state: a different review, so reuse matches on it.
ALTER TABLE audits ADD COLUMN state TEXT;
