import { Hono } from 'hono';
import { isProvider } from './audit';
import { chatJson, ModelError, sam, toDataUrl, type ContentPart, type Usage } from './models';

// $ per 1M tokens. Meta Standard per prep/meta-api-facts.md; Baseten Model API per baseten.co/library/muse-spark-open.
const PRICES = {
  'meta-api': { input: 1.25, cached: 0.15, output: 4.25 },
  'open-weights': { input: 1.25, cached: 0.15, output: 4.25 },
} as const;
const SAM_PER_IMAGE = 2.5 / 1000;

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

const cost = (provider: keyof typeof PRICES, u: Usage) => {
  const p = PRICES[provider];
  return ((u.inputTokens - u.cachedTokens) * p.input + u.cachedTokens * p.cached + u.outputTokens * p.output) / 1e6;
};

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
      const out = await sam(c.env, bytes, file.type, String(form?.get('phrase') ?? 'price table'));
      return c.json({ ...out, costUsd: SAM_PER_IMAGE });
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
    return c.json({ ...out, costUsd: cost(provider, out.usage) });
  } catch (e) {
    if (e instanceof ModelError) return c.json({ error: e.body, status: e.status, provider: e.provider }, 502);
    throw e;
  }
});
