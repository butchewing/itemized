import ruleset from '../prep/rules/ftc-453@2026.1.json';
import type { AuditStatus } from './audit';
import { EXTRACTION_SCHEMA, ExtractionError, parseExtraction, SYSTEM_PROMPT, type GplExtraction } from './extraction';
import {
  chatJson,
  costUsd,
  ModelError,
  PROVIDER_CONFIG,
  toDataUrl,
  type ContentPart,
  type ReasoningEffort,
  type Usage,
} from './models';
import { runChecks } from './rules/engine';
import {
  getAudit,
  getExtraction,
  putExtraction,
  putReport,
  recordModelCall,
  spendTodayUtc,
  transition,
  type AuditRow,
} from './store';

// Failures whose message is safe to show the uploader.
class AuditFailure extends Error {}

const isRetryable = (e: unknown) => e instanceof ModelError && (e.status === 429 || e.status >= 500);

async function assertUnderBudget(env: Env) {
  const limit = Number(env.DAILY_BUDGET_USD);
  if (!Number.isFinite(limit)) throw new Error('DAILY_BUDGET_USD is not a number');
  if ((await spendTodayUtc(env.DB)) >= limit) throw new AuditFailure('daily budget reached');
}

// 'minimal' is tried first; if the provider rejects it the isolate falls back to 'low' for good.
let effort: ReasoningEffort = 'minimal';
const rejectsEffort = (e: unknown) => e instanceof ModelError && e.status === 400 && /reasoning/i.test(e.body);

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };

async function callExtractor(env: Env, audit: AuditRow, doc: ContentPart): Promise<GplExtraction> {
  const { provider } = audit;
  const model = PROVIDER_CONFIG[provider].model;
  for (;;) {
    await assertUnderBudget(env);
    const used = effort;
    let usage = ZERO_USAGE;
    const t0 = Date.now();
    const record = (error: string | null, ms: number) =>
      recordModelCall(env.DB, {
        auditId: audit.id, provider, model, purpose: `extract/${used}`, usage, costUsd: costUsd(provider, usage), ms, error,
      });
    try {
      const out = await chatJson(env, provider, {
        system: SYSTEM_PROMPT,
        parts: [{ type: 'text', text: 'Transcribe this General Price List.' }, doc],
        schema: EXTRACTION_SCHEMA,
        reasoningEffort: used,
      });
      usage = out.usage;
      const extraction = parseExtraction(out.json);
      await record(null, out.ms);
      return extraction;
    } catch (e) {
      if (e instanceof ModelError && e.usage) usage = e.usage;
      await record(e instanceof Error ? e.message.slice(0, 800) : 'unknown error', Date.now() - t0);
      if (used === 'minimal' && rejectsEffort(e)) {
        effort = 'low';
        continue;
      }
      throw e;
    }
  }
}

async function extract(env: Env, audit: AuditRow): Promise<GplExtraction> {
  const isPdf = audit.content_type === 'application/pdf';
  if (isPdf && audit.provider === 'open-weights') throw new AuditFailure('PDF not supported on open-weights yet');
  const cached = await getExtraction(env.DB, audit.doc_sha256, audit.provider);
  if (cached) return cached;

  const object = await env.DOCS.get(audit.doc_key);
  if (!object) throw new AuditFailure('document not found in storage');
  const url = toDataUrl(await object.arrayBuffer(), audit.content_type);
  const doc: ContentPart = isPdf
    ? { type: 'file', file: { filename: audit.filename ?? 'document.pdf', file_data: url } }
    : { type: 'image_url', image_url: { url } };
  const extraction = await callExtractor(env, audit, doc);
  await putExtraction(env.DB, audit.doc_sha256, audit.provider, extraction);
  return extraction;
}

function failureMessage(e: unknown): string {
  if (e instanceof AuditFailure) return e.message;
  if (e instanceof ExtractionError) return 'model returned an invalid extraction';
  if (e instanceof ModelError) return `model request failed (${e.status})`;
  console.error('audit pipeline error', e instanceof Error ? e.name : typeof e);
  return 'internal error';
}

// Resumable: a retried message finds the audit in `extracting` or `checking` and continues;
// the extraction cache makes the second pass free.
export async function runAudit(env: Env, auditId: string, canRetry: boolean): Promise<'ack' | 'retry'> {
  const audit = await getAudit(env.DB, auditId);
  if (!audit) return 'ack';
  const resumable: AuditStatus[] = ['queued', 'extracting', 'checking'];
  if (!resumable.includes(audit.status)) return 'ack';
  let status = audit.status;
  if (status === 'queued') {
    if (!(await transition(env.DB, audit.id, 'queued', 'extracting'))) return 'ack';
    status = 'extracting';
  }

  let extraction: GplExtraction;
  try {
    extraction = await extract(env, audit);
  } catch (e) {
    if (canRetry && isRetryable(e)) return 'retry';
    await transition(env.DB, audit.id, status, 'failed', failureMessage(e));
    return 'ack';
  }
  if (status === 'extracting') await transition(env.DB, audit.id, 'extracting', 'checking');

  try {
    await putReport(env.DB, audit.id, runChecks(extraction, ruleset, { auditDate: new Date() }));
  } catch (e) {
    await transition(env.DB, audit.id, 'checking', 'failed', failureMessage(e));
    return 'ack';
  }
  await transition(env.DB, audit.id, 'checking', 'done');
  return 'ack';
}
