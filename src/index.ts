import { Hono } from 'hono';
import {
  canTransition,
  isAcceptedType,
  isProvider,
  MAX_UPLOAD_BYTES,
  type AuditMessage,
  type AuditStatus,
  type Provider,
} from './audit';
import { PAGE } from './page';
import { spike } from './spike';

type AuditRow = {
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

const getAudit = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM audits WHERE id = ?').bind(id).first<AuditRow>();

// Guarded on the current status so a redelivered message cannot repeat a transition.
async function transition(
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
  return row ? c.json(toJson(row)) : c.json({ error: 'Not found.' }, 404);
});

async function queue(batch: MessageBatch<AuditMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const audit = await getAudit(env.DB, msg.body.auditId);
    if (audit?.status === 'queued' && (await transition(env.DB, audit.id, 'queued', 'extracting'))) {
      await transition(env.DB, audit.id, 'extracting', 'failed', 'pipeline not implemented yet');
    }
    msg.ack();
  }
}

export default { fetch: app.fetch, queue } satisfies ExportedHandler<Env, AuditMessage>;
