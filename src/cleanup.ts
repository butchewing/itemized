import type { Provider } from './audit';
import { daysBefore, REUSE_DAYS } from './store';

export type CleanupAuditRow = { id: string; doc_sha256: string; provider: Provider; last_used_at: string };

export type CleanupPlan = {
  cutoff: string;
  auditIds: string[];
  // Extraction and semantic cache rows are keyed per document and provider.
  cachePairs: { sha256: string; provider: Provider }[];
  // R2 holds one object per document, whatever the provider.
  docShas: string[];
};

export function planCleanup(audits: readonly CleanupAuditRow[], now: Date): CleanupPlan {
  const cutoff = daysBefore(now, REUSE_DAYS);
  const expired = audits.filter((a) => a.last_used_at < cutoff);
  const kept = audits.filter((a) => a.last_used_at >= cutoff);
  const keptPairs = new Set(kept.map((a) => `${a.doc_sha256}|${a.provider}`));
  const keptShas = new Set(kept.map((a) => a.doc_sha256));

  const cachePairs = new Map<string, { sha256: string; provider: Provider }>();
  for (const a of expired) {
    const key = `${a.doc_sha256}|${a.provider}`;
    if (!keptPairs.has(key)) cachePairs.set(key, { sha256: a.doc_sha256, provider: a.provider });
  }
  return {
    cutoff,
    auditIds: expired.map((a) => a.id),
    cachePairs: [...cachePairs.values()],
    docShas: [...new Set(expired.map((a) => a.doc_sha256).filter((s) => !keptShas.has(s)))],
  };
}

// D1 allows at most 100 bound parameters per statement.
const chunk = <T>(xs: readonly T[], n: number) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export type CleanupCounts = { audits: number; reports: number; extractions: number; semantic: number; modelCalls: number; docs: number; pdfs: number };

// Stored files go first: if a later step fails, the next run plans the same audits again and finds
// them. Every delete re-checks the cutoff or the remaining audits, so a run that races an upload of
// the same file deletes nothing that is still in use.
export async function runCleanup(env: Pick<Env, 'DB' | 'DOCS'>, now: Date): Promise<CleanupCounts> {
  const { results } = await env.DB.prepare(
    'SELECT id, doc_sha256, provider, COALESCE(last_used_at, created_at) AS last_used_at FROM audits',
  ).all<CleanupAuditRow>();
  const plan = planCleanup(results, now);
  const counts: CleanupCounts = { audits: 0, reports: 0, extractions: 0, semantic: 0, modelCalls: 0, docs: 0, pdfs: 0 };

  for (const sha of plan.docShas) {
    // An upload re-puts the object just before it reuses or inserts an audit, so an object written
    // in the last minute may belong to an upload that is still under way.
    const head = await env.DOCS.head(`docs/${sha}`);
    if (head && now.getTime() - head.uploaded.getTime() > 60_000) {
      await env.DOCS.delete(`docs/${sha}`);
      counts.docs++;
    }
  }
  for (const ids of chunk(plan.auditIds, 1000)) {
    const keys = ids.map((id) => `docs/reports/${id}.pdf`);
    const present = await Promise.all(keys.map((k) => env.DOCS.head(k)));
    const toDelete = keys.filter((_, i) => present[i]);
    if (toDelete.length) await env.DOCS.delete(toDelete);
    counts.pdfs += toDelete.length;
  }

  for (const ids of chunk(plan.auditIds, 90)) {
    const stale = `id IN (${ids.map(() => '?').join(',')}) AND COALESCE(last_used_at, created_at) < ?`;
    const [reports, audits] = await env.DB.batch([
      env.DB.prepare(`DELETE FROM reports WHERE audit_id IN (SELECT id FROM audits WHERE ${stale})`).bind(...ids, plan.cutoff),
      env.DB.prepare(`DELETE FROM audits WHERE ${stale}`).bind(...ids, plan.cutoff),
    ]);
    counts.reports += reports!.meta.changes;
    counts.audits += audits!.meta.changes;
  }

  const orphan = 'doc_sha256 = ? AND provider = ? AND NOT EXISTS (SELECT 1 FROM audits a WHERE a.doc_sha256 = ? AND a.provider = ?)';
  for (const { sha256, provider } of plan.cachePairs) {
    const args = [sha256, provider, sha256, provider];
    const [x, s] = await env.DB.batch([
      env.DB.prepare(`DELETE FROM extractions WHERE ${orphan}`).bind(...args),
      env.DB.prepare(`DELETE FROM semantic_results WHERE ${orphan}`).bind(...args),
    ]);
    counts.extractions += x!.meta.changes;
    counts.semantic += s!.meta.changes;
  }

  const calls = await env.DB.prepare('DELETE FROM model_calls WHERE created_at < ?').bind(plan.cutoff).run();
  counts.modelCalls = calls.meta.changes;
  return counts;
}
