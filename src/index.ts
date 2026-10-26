import puppeteer from '@cloudflare/puppeteer';
import { Hono } from 'hono';
import {
  isAcceptedType,
  isProvider,
  MAX_UPLOAD_BYTES,
  type AuditMessage,
  type AuditStatus,
} from './audit';
import { runAudit } from './pipeline';
import { auditSpend, getAudit, getExtraction, getReport, loadReview, type AuditRow } from './store';
import { renderLetterHtml } from './letter';
import { PAGE } from './page';
import { notFoundPage, PDF_FAILED, pdfFilename, reviewPage } from './review';
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

app.get('/api/audits/:id/letter', async (c) => {
  const view = await loadReview(c.env.DB, c.req.param('id'));
  if (view === 'not_found') return c.json({ error: 'Not found.' }, 404);
  if (view === 'not_ready') return c.json({ error: 'The review is not finished yet.' }, 409);
  return c.json({ html: renderLetterHtml(view) });
});

app.get('/r/:id', async (c) => {
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const view = await loadReview(c.env.DB, c.req.param('id'));
  if (typeof view === 'string') return c.html(notFoundPage(), 404);
  return c.html(reviewPage(view.id, renderLetterHtml(view), view.extraction?.providerName ?? null));
});

async function renderPdf(browserBinding: Env['BROWSER'], html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({
      format: 'letter',
      printBackground: true,
      margin: { top: '0.6in', right: '0.6in', bottom: '0.6in', left: '0.6in' },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}

app.get('/r/:id/pdf', async (c) => {
  const view = await loadReview(c.env.DB, c.req.param('id'));
  if (view === 'not_found') return c.json({ error: 'Not found.' }, 404);
  if (view === 'not_ready') return c.json({ error: 'The review is not finished yet.' }, 409);

  // docs/ inherits the bucket's 30-day deletion rule.
  const key = `docs/reports/${view.id}.pdf`;
  let body: ReadableStream | Uint8Array;
  const cached = await c.env.DOCS.get(key);
  if (cached) {
    body = cached.body;
  } else {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    if (!(await c.env.UPLOAD_LIMITER.limit({ key: `pdf:${ip}` })).success) {
      return c.json({ error: 'Too many PDFs. Try again in a minute.' }, 429);
    }
    const provider = view.extraction?.providerName ?? null;
    try {
      body = await renderPdf(c.env.BROWSER, reviewPage(view.id, renderLetterHtml(view, 'print'), provider));
    } catch (err) {
      console.error('pdf render failed', err);
      return c.json({ error: PDF_FAILED }, 503);
    }
    await c.env.DOCS.put(key, body, { httpMetadata: { contentType: 'application/pdf' } });
  }
  return new Response(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFilename(view.extraction?.providerName ?? null, view.date)}"`,
      'X-Robots-Tag': 'noindex',
    },
  });
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

app.notFound((c) =>
  c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.html(notFoundPage('page'), 404),
);

export default { fetch: app.fetch, queue } satisfies ExportedHandler<Env, AuditMessage>;
