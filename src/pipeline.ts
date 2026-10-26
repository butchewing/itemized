import ruleset from '../prep/rules/ftc-453@2026.1.json';
import type { AuditDocument, AuditStatus } from './audit';
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
  parseSemantic,
  SEMANTIC_PROMPT_VERSION,
  SEMANTIC_SCHEMA,
  SEMANTIC_SYSTEM_PROMPT,
  semanticUserText,
  type SemanticResults,
} from './rules/semantic';
import {
  auditDocument,
  getAudit,
  getExtraction,
  getSemantic,
  putExtraction,
  putReport,
  putSemantic,
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

async function callExtractor(env: Env, audit: AuditRow, parts: ContentPart[]): Promise<GplExtraction> {
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
        parts,
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

const TRANSCRIBE = 'Transcribe this General Price List.';

// One page keeps the instruction it had before multi-page uploads, so its wording matches the eval baseline.
export function pagesInstruction(n: number): string {
  if (n === 1) return TRANSCRIBE;
  const order = Array.from({ length: n }, (_, i) => `image ${i + 1} is page ${i + 1}`).join(', ');
  return `${TRANSCRIBE} It has ${n} pages, sent as ${n} images in page order: ${order}.`;
}

async function load(env: Env, key: string) {
  const object = await env.DOCS.get(key);
  if (!object) throw new AuditFailure('document not found in storage');
  return object.arrayBuffer();
}

async function documentParts(env: Env, audit: AuditRow, doc: AuditDocument): Promise<ContentPart[]> {
  if (doc.kind === 'pdf') {
    const url = toDataUrl(await load(env, doc.key), 'application/pdf');
    return [{ type: 'text', text: TRANSCRIBE }, { type: 'file', file: { filename: audit.filename ?? 'document.pdf', file_data: url } }];
  }
  const parts: ContentPart[] = [{ type: 'text', text: pagesInstruction(doc.pages.length) }];
  for (const page of doc.pages) {
    parts.push({ type: 'image_url', image_url: { url: toDataUrl(await load(env, page.key), page.contentType) } });
  }
  return parts;
}

async function extract(env: Env, audit: AuditRow): Promise<GplExtraction> {
  const doc = auditDocument(audit);
  if (doc.kind === 'pdf' && audit.provider === 'open-weights') throw new AuditFailure('PDF not supported on open-weights yet');
  const cached = await getExtraction(env.DB, audit.doc_sha256, audit.provider);
  if (cached) return cached;
  const extraction = await callExtractor(env, audit, await documentParts(env, audit, doc));
  await putExtraction(env.DB, audit.doc_sha256, audit.provider, extraction);
  return extraction;
}

// Judgment needs some reasoning, unlike transcription.
export const SEMANTIC_EFFORT: ReasoningEffort = 'low';

// Runs on the audit's own provider so open-weights audits never send list text to the Meta API.
// Any failure (budget, model, parse) returns null: the report then lists these checks as not run.
async function judge(env: Env, audit: AuditRow, extraction: GplExtraction): Promise<SemanticResults | null> {
  const { provider } = audit;
  const skipped = (e: unknown) => {
    console.error(`semantic checks skipped (${SEMANTIC_PROMPT_VERSION}):`, e instanceof Error ? e.message.slice(0, 200) : typeof e);
    return null;
  };
  try {
    const cached = await getSemantic(env.DB, audit.doc_sha256, provider);
    if (cached) return cached;
    await assertUnderBudget(env);
  } catch (e) {
    return skipped(e);
  }

  const model = PROVIDER_CONFIG[provider].model;
  let usage = ZERO_USAGE;
  const t0 = Date.now();
  const record = (error: string | null, ms: number) =>
    recordModelCall(env.DB, {
      auditId: audit.id, provider, model, purpose: `semantic/${SEMANTIC_EFFORT}`, usage, costUsd: costUsd(provider, usage), ms, error,
    });
  try {
    const out = await chatJson(env, provider, {
      system: SEMANTIC_SYSTEM_PROMPT,
      parts: [{ type: 'text', text: semanticUserText(extraction) }],
      schema: SEMANTIC_SCHEMA,
      reasoningEffort: SEMANTIC_EFFORT,
    });
    usage = out.usage;
    const results = parseSemantic(out.json);
    await putSemantic(env.DB, audit.doc_sha256, provider, out.json);
    await record(null, out.ms);
    return results;
  } catch (e) {
    if (e instanceof ModelError && e.usage) usage = e.usage;
    await record(e instanceof Error ? e.message.slice(0, 800) : 'unknown error', Date.now() - t0).catch(() => {});
    return skipped(e);
  }
}

function failureMessage(e: unknown): string {
  if (e instanceof AuditFailure) return e.message;
  if (e instanceof ExtractionError) return 'model returned an invalid extraction';
  if (e instanceof ModelError) return `model request failed (${e.status})`;
  console.error('audit pipeline error', e instanceof Error ? e.name : typeof e);
  return 'internal error';
}

// Resumable: a retried message finds the audit in `extracting` or `checking` and continues;
// the extraction and semantic caches make the second pass free.
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

  const semantic = await judge(env, audit, extraction);
  try {
    await putReport(env.DB, audit.id, runChecks(extraction, ruleset, { auditDate: new Date(), semantic }));
  } catch (e) {
    await transition(env.DB, audit.id, 'checking', 'failed', failureMessage(e));
    return 'ack';
  }
  await transition(env.DB, audit.id, 'checking', 'done');
  return 'ack';
}
