import { canTransition, type AuditStatus, type Provider } from './audit';
import { PROMPT_VERSION, type GplExtraction } from './extraction';
import { PROVIDER_CONFIG, type Usage } from './models';

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
};

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
