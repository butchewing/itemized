-- A read made from rendered page images records the render: renderer version, pages, and each page's
-- text-layer characters. The rules engine uses it to pick the PDF rules or the photo rule.
ALTER TABLE extractions ADD COLUMN render TEXT;
