CREATE TABLE semantic_results (
  doc_sha256 TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  extraction_prompt_version TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (doc_sha256, provider, model, prompt_version, extraction_prompt_version, ruleset_version)
);
