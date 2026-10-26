import { Hono } from 'hono';
import { isProvider } from './audit';
import { chatJson, costUsd, ModelError, SAM_PER_IMAGE_USD, sam, toDataUrl, type ContentPart } from './models';

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
      const out = await sam(c.env, bytes, file.type, String(form?.get('phrase') ?? 'price table'));
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
