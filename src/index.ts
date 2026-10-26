import { Hono } from 'hono';
import {
  isAcceptedType,
  isProvider,
  MAX_UPLOAD_BYTES,
  type AuditMessage,
  type AuditStatus,
} from './audit';
import { runAudit } from './pipeline';
import { auditSpend, getAudit, getExtraction, getReport, type AuditRow } from './store';
import { PAGE } from './page';
import { spike } from './spike';

const toJson = (r: AuditRow) => ({
  id: r.id,
  status: r.status,
  provider: r.provider,
  docKey: r.doc_key,
  docSha256: r.doc_sha256,
  contentType: r.content_type,
  filename: r.filename,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

const app = new Hono<{ Bindings: Env }>();

app.use('/dev/*', async (c, next) => (c.env.DEV_ROUTES === '1' ? next() : c.notFound()));
app.route('/dev', spike);

app.get('/', (c) => {
  c.header('X-Robots-Tag', 'noindex, nofollow');
  return c.html(PAGE);
});

app.post('/api/audits', async (c) => {
  if (!isProvider(c.env.MODEL_PROVIDER)) return c.json({ error: 'Server misconfigured.' }, 500);
  const provider = c.env.MODEL_PROVIDER;

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  if (!(await c.env.UPLOAD_LIMITER.limit({ key: `upload:${ip}` })).success) {
    return c.json({ error: 'Too many uploads. Try again in a minute.' }, 429);
  }

  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return c.json({ error: 'Expected a multipart "file" field.' }, 400);
  if (!isAcceptedType(file.type)) {
    return c.json({ error: 'Unsupported file type. Upload a PDF, JPEG, PNG or WebP.' }, 415);
  }
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'File must be between 1 byte and 20 MB.' }, 413);
  }

  const bytes = await file.arrayBuffer();
  const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
  const docKey = `docs/${sha256}`;
  if (!(await c.env.DOCS.head(docKey))) {
    await c.env.DOCS.put(docKey, bytes, { httpMetadata: { contentType: file.type } });
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO audits (id, status, provider, doc_key, doc_sha256, content_type, filename)
     VALUES (?, 'queued', ?, ?, ?, ?, ?)`,
  )
    .bind(id, provider, docKey, sha256, file.type, file.name || null)
    .run();
  await c.env.AUDITS.send({ auditId: id } satisfies AuditMessage);

  return c.json({ id, status: 'queued' satisfies AuditStatus }, 202);
});

app.get('/api/audits/:id', async (c) => {
  const row = await getAudit(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found.' }, 404);
  const [extraction, report, spend] = await Promise.all([
    getExtraction(c.env.DB, row.doc_sha256, row.provider),
    getReport(c.env.DB, row.id),
    auditSpend(c.env.DB, row.id),
  ]);
  return c.json({ ...toJson(row), extraction, report, ...spend });
});

// Mirrors max_retries in wrangler.jsonc.
const MAX_RETRIES = 3;

async function queue(batch: MessageBatch<AuditMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const outcome = await runAudit(env, msg.body.auditId, msg.attempts <= MAX_RETRIES);
    if (outcome === 'retry') msg.retry({ delaySeconds: 10 * msg.attempts });
    else msg.ack();
  }
}

export default { fetch: app.fetch, queue } satisfies ExportedHandler<Env, AuditMessage>;
