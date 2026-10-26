#!/usr/bin/env node
// Copies cached synthetic-document extractions and semantic results from local D1 (wrangler dev
// state) into test/fixtures/extractions and test/fixtures/semantic. Synthetic and FTC-template
// files only; anything else is skipped.
//   node test/export-fixtures.mjs
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const D1_DIR = join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const OUT = join(ROOT, 'test/fixtures/extractions');
const SEMANTIC_OUT = join(ROOT, 'test/fixtures/semantic');
const SEMANTIC_PROMPT_VERSION = readFileSync(join(ROOT, 'src/rules/semantic.ts'), 'utf8').match(/SEMANTIC_PROMPT_VERSION = '([^']+)'/)[1];
const ALLOWED = /^(syn-\d{2}(-\d)?\.(pdf|jpeg)|ftc-sample1-gpl-template\.pdf)$/;
const SUBDIR = { 'meta-api': '', 'open-weights': 'open-weights' };

const dbFile = readdirSync(D1_DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
if (!dbFile) throw new Error('no local D1 database; run wrangler dev once');
const db = new DatabaseSync(join(D1_DIR, dbFile), { readOnly: true });
const rows = db
  .prepare(
    `SELECT DISTINCT a.filename, e.provider, e.json FROM extractions e
     JOIN audits a ON a.doc_sha256 = e.doc_sha256 AND a.provider = e.provider
     WHERE e.prompt_version = 'extract-1' ORDER BY a.filename, e.provider`,
  )
  .all();

const written = new Set();
for (const { filename, provider, json } of rows) {
  if (!ALLOWED.test(filename ?? '') || !(provider in SUBDIR)) continue;
  const dir = join(OUT, SUBDIR[provider]);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${filename}.json`);
  if (written.has(path)) continue;
  written.add(path);
  writeFileSync(path, `${JSON.stringify(JSON.parse(json), null, 1)}\n`);
  console.log(`${provider.padEnd(13)} ${filename}`);
}

const semanticRows = db
  .prepare(
    `SELECT DISTINCT a.filename, s.provider, s.json FROM semantic_results s
     JOIN audits a ON a.doc_sha256 = s.doc_sha256 AND a.provider = s.provider
     WHERE s.prompt_version = ? AND s.extraction_prompt_version = 'extract-1' ORDER BY a.filename, s.provider`,
  )
  .all(SEMANTIC_PROMPT_VERSION);
for (const { filename, provider, json } of semanticRows) {
  if (!ALLOWED.test(filename ?? '') || !(provider in SUBDIR)) continue;
  const dir = join(SEMANTIC_OUT, SUBDIR[provider]);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${filename}.json`);
  if (written.has(path)) continue;
  written.add(path);
  writeFileSync(path, `${JSON.stringify(JSON.parse(json), null, 1)}\n`);
  console.log(`${provider.padEnd(13)} ${filename} (semantic)`);
}
