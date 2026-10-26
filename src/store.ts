import ruleset from '../prep/rules/ftc-453@2026.1.json';
import { canTransition, type AuditDocument, type AuditStatus, type ImageType, type Provider, type StoredPage } from './audit';
import { PROMPT_VERSION, type GplExtraction } from './extraction';
import { PROVIDER_CONFIG, type Usage } from './models';
import { parseSemantic, SEMANTIC_PROMPT_VERSION } from './rules/semantic';
import type { LetterInput } from './letter';
import type { Report } from './rules/types';

export type AuditRow = {
  id: string;
  status: AuditStatus;
  provider: Provider;
  doc_key: string;
  doc_sha256: string;
  content_type: string;
  filename: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  versions: string | null;
  pages: string | null;
};

// Rows from before migration 0006 hold a single image with pages NULL.
export function auditDocument(row: Pick<AuditRow, 'doc_key' | 'content_type' | 'pages'>): AuditDocument {
  if (row.pages !== null) return { kind: 'pages', pages: JSON.parse(row.pages) as StoredPage[] };
  if (row.content_type === 'application/pdf') return { kind: 'pdf', key: row.doc_key };
  return { kind: 'pages', pages: [{ key: row.doc_key, contentType: row.content_type as ImageType }] };
}

export const documentKeys = (d: AuditDocument) => (d.kind === 'pdf' ? [d.key] : d.pages.map((p) => p.key));

// Every version a finished audit's report depends on. An audit is reused only when this matches.
export const PIPELINE_VERSIONS = `${PROMPT_VERSION}|${SEMANTIC_PROMPT_VERSION}|${ruleset.id}@${ruleset.version}`;

export const REUSE_DAYS = 30;
// toISOString matches the schema's strftime('%Y-%m-%dT%H:%M:%fZ'), so the strings compare in time order.
export const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

// An unfinished audit is reused only while it is still moving: one whose queue message was lost
// would otherwise be handed back, never finishing, for as long as people keep uploading the file.
const STALLED_AFTER_MS = 15 * 60_000;

export async function findReusable(db: D1Database, sha256: string, provider: Provider, now: Date) {
  return db
    .prepare(
      `SELECT id, status FROM audits
       WHERE doc_sha256 = ? AND provider = ? AND versions = ? AND last_used_at >= ?
         AND (status = 'done' OR (status != 'failed' AND updated_at >= ?))
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(sha256, provider, PIPELINE_VERSIONS, daysBefore(now, REUSE_DAYS), new Date(now.getTime() - STALLED_AFTER_MS).toISOString())
    .first<{ id: string; status: AuditStatus }>();
}

export const touchAudit = (db: D1Database, id: string, now: Date) =>
  db.prepare('UPDATE audits SET last_used_at = ? WHERE id = ?').bind(now.toISOString(), id).run();

export type NewAudit = { id: string; provider: Provider; document: AuditDocument; sha256: string; filename: string | null };

export async function createAudit(db: D1Database, a: NewAudit, now: Date) {
  const at = now.toISOString();
  const d = a.document;
  // For page images, doc_key and content_type describe page 1 and pages lists every page.
  const [docKey, contentType, pages] =
    d.kind === 'pdf' ? [d.key, 'application/pdf', null] : [d.pages[0]!.key, d.pages[0]!.contentType, JSON.stringify(d.pages)];
  await db
    .prepare(
      `INSERT INTO audits (id, status, provider, doc_key, doc_sha256, content_type, filename, created_at, updated_at, last_used_at, versions, pages)
       VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(a.id, a.provider, docKey, a.sha256, contentType, a.filename, at, at, at, PIPELINE_VERSIONS, pages)
    .run();
}

export const getAudit = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM audits WHERE id = ?').bind(id).first<AuditRow>();

// Guarded on the current status so a redelivered message cannot repeat a transition.
export async function transition(
  db: D1Database,
  id: string,
  from: AuditStatus,
  to: AuditStatus,
  error?: string,
): Promise<boolean> {
  if (!canTransition(from, to)) throw new Error(`illegal transition ${from} -> ${to}`);
  const res = await db
    .prepare(
      `UPDATE audits SET status = ?, error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status = ?`,
    )
    .bind(to, error ?? null, id, from)
    .run();
  return res.meta.changes > 0;
}

export async function getExtraction(db: D1Database, sha256: string, provider: Provider) {
  const row = await db
    .prepare(
      `SELECT json FROM extractions
       WHERE doc_sha256 = ? AND provider = ? AND model = ? AND prompt_version = ?`,
    )
    .bind(sha256, provider, PROVIDER_CONFIG[provider].model, PROMPT_VERSION)
    .first<{ json: string }>();
  return row ? (JSON.parse(row.json) as GplExtraction) : null;
}

export async function putExtraction(db: D1Database, sha256: string, provider: Provider, e: GplExtraction) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO extractions (doc_sha256, provider, model, prompt_version, json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(sha256, provider, PROVIDER_CONFIG[provider].model, PROMPT_VERSION, JSON.stringify(e))
    .run();
}

// Keyed on everything its input depends on: the document, who extracted it and how, and the checks asked.
const semanticKey = (sha256: string, provider: Provider) =>
  [sha256, provider, PROVIDER_CONFIG[provider].model, SEMANTIC_PROMPT_VERSION, PROMPT_VERSION, `${ruleset.id}@${ruleset.version}`] as const;

export async function getSemantic(db: D1Database, sha256: string, provider: Provider) {
  const row = await db
    .prepare(
      `SELECT json FROM semantic_results
       WHERE doc_sha256 = ? AND provider = ? AND model = ? AND prompt_version = ? AND extraction_prompt_version = ? AND ruleset_version = ?`,
    )
    .bind(...semanticKey(sha256, provider))
    .first<{ json: string }>();
  return row ? parseSemantic(JSON.parse(row.json)) : null;
}

// Stores the model's output as returned, so fixtures and cache share one parser.
export async function putSemantic(db: D1Database, sha256: string, provider: Provider, modelJson: unknown) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO semantic_results
         (doc_sha256, provider, model, prompt_version, extraction_prompt_version, ruleset_version, json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(...semanticKey(sha256, provider), JSON.stringify(modelJson))
    .run();
}

export type ModelCallRecord = {
  auditId: string | null;
  provider: Provider;
  model: string;
  purpose: string;
  usage: Usage;
  costUsd: number;
  ms: number;
  error: string | null;
};

export async function recordModelCall(db: D1Database, c: ModelCallRecord) {
  await db
    .prepare(
      `INSERT INTO model_calls
         (audit_id, provider, model, purpose, input_tokens, output_tokens, reasoning_tokens, cached_tokens, cost_usd, ms, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      c.auditId, c.provider, c.model, c.purpose,
      c.usage.inputTokens, c.usage.outputTokens, c.usage.reasoningTokens, c.usage.cachedTokens,
      c.costUsd, c.ms, c.error === null ? 1 : 0, c.error,
    )
    .run();
}

export async function auditSpend(db: D1Database, auditId: string) {
  const row = await db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(ms), 0) AS ms FROM model_calls WHERE audit_id = ?')
    .bind(auditId)
    .first<{ cost: number; ms: number }>();
  return { costUsd: row?.cost ?? 0, modelMs: row?.ms ?? 0 };
}

export async function spendTodayUtc(db: D1Database) {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM model_calls WHERE substr(created_at, 1, 10) = date('now')`)
    .first<{ cost: number }>();
  return row?.cost ?? 0;
}

export async function putReport(db: D1Database, auditId: string, report: Report) {
  await db
    .prepare('INSERT OR REPLACE INTO reports (audit_id, ruleset_version, json) VALUES (?, ?, ?)')
    .bind(auditId, `${report.rulesetId}@${report.rulesetVersion}`, JSON.stringify(report))
    .run();
}

export async function getReport(db: D1Database, auditId: string) {
  const row = await db.prepare('SELECT json FROM reports WHERE audit_id = ?').bind(auditId).first<{ json: string }>();
  return row ? (JSON.parse(row.json) as Report) : null;
}

export type ReviewView = LetterInput & { id: string };

export async function loadReview(db: D1Database, id: string): Promise<ReviewView | 'not_found' | 'not_ready'> {
  const row = await getAudit(db, id);
  if (!row) return 'not_found';
  if (row.status !== 'done') return 'not_ready';
  const [extraction, report] = await Promise.all([getExtraction(db, row.doc_sha256, row.provider), getReport(db, row.id)]);
  if (!report) return 'not_ready';
  return {
    id: row.id,
    date: new Date(row.updated_at),
    uploadedAt: new Date(row.created_at),
    docSha256: row.doc_sha256,
    modelName: PROVIDER_CONFIG[row.provider].displayName,
    extraction,
    report,
  };
}
