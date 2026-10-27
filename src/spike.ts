import { Hono } from 'hono';
import ruleset from '../prep/rules/ftc-453@2026.1.json';
import { isProvider } from './audit';
import { chatJson, costUsd, ModelError, PROVIDER_CONFIG, SAM_PER_IMAGE_USD, sam, toDataUrl, type ContentPart, type Usage } from './models';
import { DISCLOSURE_IDS } from './extraction';
import { extractFresh, SEMANTIC_EFFORT, type ExtractInput } from './pipeline';
import { runChecks } from './rules/engine';
import { buildCorpus, matchDisclosure } from './rules/text';
import {
  parseSemantic,
  SEMANTIC_CHECK_IDS,
  SEMANTIC_PROMPT_VERSION,
  SEMANTIC_SCHEMA,
  SEMANTIC_SYSTEM_PROMPT,
  semanticUserText,
  type SemanticResults,
} from './rules/semantic';
import { auditDocument, getAudit, getExtraction, getSemantic, recordModelCall, spendTodayUtc } from './store';

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

// Fixed so the stale-date check does not drift between runs.
const EVAL_AUDIT_DATE = new Date('2026-10-26T00:00:00Z');

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

// One fresh extraction of the uploaded pages (images, batched as an audit would be) or PDF, for
// test/eval/extraction-variance.mjs. Reads and writes no cache. The provider must be the one this
// Worker runs, so the driver's corpus guard can trust /dev/provider. Deterministic checks only:
// the semantic step is not run, so those checks are absent from the reports.
spike.post('/variance-extract', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const provider = String(form?.get('provider') ?? '');
  const files = (form?.getAll('file') ?? []).filter((f): f is File => f instanceof File);
  if (!isProvider(provider) || !files.length) return c.json({ error: 'provider and file required' }, 400);
  if (provider !== (c.env.MODEL_PROVIDER as string)) return c.json({ error: `this Worker runs ${c.env.MODEL_PROVIDER}` }, 409);
  const pdf = files[0]!.type === 'application/pdf';
  if (pdf && files.length !== 1) return c.json({ error: 'one PDF at a time' }, 400);
  if (pdf && provider === 'open-weights') return c.json({ error: 'PDF not supported on open-weights yet' }, 400);
  if ((await spendTodayUtc(c.env.DB)) >= Number(c.env.DAILY_BUDGET_USD)) return c.json({ error: 'daily budget reached' }, 429);

  const input: ExtractInput = pdf
    ? { kind: 'pdf', filename: files[0]!.name || 'document.pdf', bytes: await files[0]!.arrayBuffer() }
    : { kind: 'images', images: await Promise.all(files.map(async (f) => ({ bytes: await f.arrayBuffer(), contentType: f.type }))) };

  const lastId =
    (await c.env.DB.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM model_calls').first<{ id: number }>())?.id ?? 0;
  const calls = () =>
    c.env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd, COALESCE(SUM(ms), 0) AS ms FROM model_calls WHERE purpose LIKE 'variance-extract/%' AND id > ?")
      .bind(lastId)
      .first<{ usd: number; ms: number }>();
  try {
    const extraction = await extractFresh(c.env, { provider, auditId: null, purpose: 'variance-extract' }, input);
    const corpus = buildCorpus(extraction);
    const disclosures = Object.fromEntries(
      DISCLOSURE_IDS.map((id) => {
        const m = matchDisclosure(corpus, ruleset, id);
        return [id, { status: m.status, score: m.score }];
      }),
    );
    const report = (mode: 'pdf' | 'images') => runChecks(extraction, ruleset, { auditDate: EVAL_AUDIT_DATE, input: mode });
    const verdicts = (mode: 'pdf' | 'images') => {
      const out: Record<string, string> = {};
      const rank = { fail: 3, review: 2, pass: 1, not_applicable: 0 };
      for (const f of report(mode).findings) if (!out[f.checkId] || rank[f.verdict] > rank[out[f.checkId] as keyof typeof rank]) out[f.checkId] = f.verdict;
      return out;
    };
    return c.json({ extraction, disclosures, verdicts: { images: verdicts('images'), pdf: verdicts('pdf') }, cost: await calls() });
  } catch (e) {
    if (e instanceof ModelError) return c.json({ error: e.body.slice(0, 300), status: e.status, cost: await calls() }, 502);
    return c.json({ error: e instanceof Error ? e.message.slice(0, 300) : 'unknown', cost: await calls() }, 502);
  }
});

// test/eval/run.mjs refuses to upload a set unless this matches the set's declared provider.
spike.get('/provider', (c) => c.json({ provider: c.env.MODEL_PROVIDER }));

// Engine verdicts for a finished audit in both input modes, on a fixed audit date so the stale-date
// check does not drift between eval runs, plus what the cached model results cost when first made.

spike.get('/eval/:id', async (c) => {
  const audit = await getAudit(c.env.DB, c.req.param('id'));
  if (!audit || audit.status !== 'done') return c.json({ error: 'no finished audit' }, 404);
  const x = await getExtraction(c.env.DB, audit.doc_sha256, audit.provider);
  if (!x) return c.json({ error: 'no cached extraction' }, 404);
  const semantic = await getSemantic(c.env.DB, audit.doc_sha256, audit.provider);
  const report = (input: 'pdf' | 'images') => runChecks(x, ruleset, { auditDate: EVAL_AUDIT_DATE, semantic, input });

  // The audit behind the newest successful call of each kind for this document and provider made the
  // cached result; its successful calls of that kind are summed, since a batched extraction makes several.
  const firstRun = (purpose: string) =>
    c.env.DB.prepare(
      `SELECT SUM(m.cost_usd) AS usd, SUM(m.ms) AS ms FROM model_calls m
       WHERE m.ok = 1 AND m.purpose LIKE ?1 AND m.audit_id = (
         SELECT m2.audit_id FROM model_calls m2 JOIN audits a ON a.id = m2.audit_id
         WHERE a.doc_sha256 = ?2 AND a.provider = ?3 AND m2.ok = 1 AND m2.purpose LIKE ?1 ORDER BY m2.id DESC LIMIT 1)
       HAVING COUNT(*) > 0`,
    )
      .bind(`${purpose}/%`, audit.doc_sha256, audit.provider)
      .first<{ usd: number; ms: number }>();
  const [extract, judge] = await Promise.all([firstRun('extract'), firstRun('semantic')]);
  return c.json({
    provider: audit.provider,
    input: auditDocument(audit).kind === 'pdf' ? 'pdf' : 'images',
    extraction: x,
    reports: { pdf: report('pdf'), images: report('images') },
    cost: { extract, semantic: judge },
  });
});

spike.get('/spend', async (c) => {
  const since = c.req.query('since') ?? '';
  const { results } = await c.env.DB.prepare(
    'SELECT provider, COALESCE(SUM(cost_usd), 0) AS usd, COUNT(*) AS calls FROM model_calls WHERE created_at >= ? GROUP BY provider',
  )
    .bind(since)
    .all<{ provider: string; usd: number; calls: number }>();
  return c.json(Object.fromEntries(results.map((r) => [r.provider, { usd: r.usd, calls: r.calls }])));
});
