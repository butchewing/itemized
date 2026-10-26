import { Hono } from 'hono';
import ruleset from '../prep/rules/ftc-453@2026.1.json';
import { isProvider } from './audit';
import { chatJson, costUsd, ModelError, PROVIDER_CONFIG, SAM_PER_IMAGE_USD, sam, toDataUrl, type ContentPart, type Usage } from './models';
import { SEMANTIC_EFFORT } from './pipeline';
import { runChecks } from './rules/engine';
import {
  parseSemantic,
  SEMANTIC_CHECK_IDS,
  SEMANTIC_PROMPT_VERSION,
  SEMANTIC_SCHEMA,
  SEMANTIC_SYSTEM_PROMPT,
  semanticUserText,
  type SemanticResults,
} from './rules/semantic';
import { getExtraction, recordModelCall, spendTodayUtc } from './store';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['caption', 'providerName', 'effectiveDate', 'phone', 'items'],
  properties: {
    caption: { type: ['string', 'null'] },
    providerName: { type: ['string', 'null'] },
    effectiveDate: { type: ['string', 'null'] },
    phone: { type: ['string', 'null'] },
    items: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'price'],
        properties: { label: { type: 'string' }, price: { type: ['number', 'null'] } },
      },
    },
  },
};

const SYSTEM =
  'You read funeral home General Price Lists. Extract the document caption, provider name, effective date (as written), phone, and up to 20 priced line items (label, price in dollars, null if none). Copy text exactly. Use null when absent.';

export const spike = new Hono<{ Bindings: Env }>();

spike.post('/spike', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  const provider = String(form?.get('provider') ?? '');
  const mode = String(form?.get('mode') ?? 'extract');
  if (!(file instanceof File) || !isProvider(provider)) return c.json({ error: 'file and provider required' }, 400);
  const bytes = await file.arrayBuffer();

  try {
    if (mode === 'sam') {
      const phrase = String(form?.get('phrase') ?? 'price table');
      const out = await sam(c.env, bytes, file.type, phrase);
      const usage: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
      await recordModelCall(c.env.DB, {
        auditId: null, provider: 'meta-api', model: 'sam-3.1', purpose: `sam/${phrase}`, usage, costUsd: SAM_PER_IMAGE_USD, ms: out.ms, error: null,
      });
      return c.json({ ...out, costUsd: SAM_PER_IMAGE_USD });
    }
    const url = toDataUrl(bytes, file.type);
    const doc: ContentPart =
      file.type === 'application/pdf'
        ? { type: 'file', file: { filename: file.name || 'document.pdf', file_data: url } }
        : { type: 'image_url', image_url: { url } };
    const structured = form?.get('structured');
    const model = form?.get('model');
    const out = await chatJson(c.env, provider, {
      system: SYSTEM,
      parts: [{ type: 'text', text: 'Extract this price list.' }, doc],
      schema: SCHEMA,
      reasoningEffort: 'low',
      ...(structured === 'json_schema' || structured === 'prompt' ? { structured } : {}),
      ...(typeof model === 'string' && model ? { model } : {}),
    });
    return c.json({ ...out, costUsd: costUsd(provider, out.usage) });
  } catch (e) {
    if (e instanceof ModelError) return c.json({ error: e.body, status: e.status, provider: e.provider }, 502);
    throw e;
  }
});

// Re-runs the semantic step on a cached extraction without reading or writing the semantic cache,
// for test/semantic-variance.mjs. Each call is still recorded in model_calls and counts toward the budget.
spike.post('/semantic-variance', async (c) => {
  const { sha256, runs, fixture } = await c.req.json<{ sha256: string; runs: number; fixture: unknown }>();
  const provider = 'meta-api';
  const x = await getExtraction(c.env.DB, sha256, provider);
  if (!x) return c.json({ error: 'no cached extraction for this document' }, 404);
  const verdicts = (semantic: SemanticResults) => {
    const r = runChecks(x, ruleset, { auditDate: new Date('2026-10-26T00:00:00Z'), semantic });
    return Object.fromEntries(SEMANTIC_CHECK_IDS.map((id) => [id, r.findings.find((f) => f.checkId === id)!.verdict]));
  };

  const samples = [];
  for (let i = 0; i < Math.min(runs, 5); i++) {
    if ((await spendTodayUtc(c.env.DB)) >= Number(c.env.DAILY_BUDGET_USD)) return c.json({ error: 'daily budget reached' }, 429);
    let usage: Usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
    const t0 = Date.now();
    const record = (error: string | null, ms: number) =>
      recordModelCall(c.env.DB, {
        auditId: null, provider, model: PROVIDER_CONFIG[provider].model, purpose: `variance/${SEMANTIC_EFFORT}`, usage, costUsd: costUsd(provider, usage), ms, error,
      });
    try {
      const out = await chatJson(c.env, provider, {
        system: SEMANTIC_SYSTEM_PROMPT,
        parts: [{ type: 'text', text: semanticUserText(x) }],
        schema: SEMANTIC_SCHEMA,
        reasoningEffort: SEMANTIC_EFFORT,
      });
      usage = out.usage;
      const parsed = parseSemantic(out.json);
      await record(null, out.ms);
      samples.push({ raw: out.json, verdicts: verdicts(parsed), costUsd: costUsd(provider, usage) });
    } catch (e) {
      if (e instanceof ModelError && e.usage) usage = e.usage;
      const error = e instanceof Error ? e.message.slice(0, 300) : 'unknown error';
      await record(error, Date.now() - t0);
      samples.push({ error, costUsd: costUsd(provider, usage) });
    }
  }
  return c.json({ promptVersion: SEMANTIC_PROMPT_VERSION, fixtureVerdicts: verdicts(parseSemantic(fixture)), samples });
});
