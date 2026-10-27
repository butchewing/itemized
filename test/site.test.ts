import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { PAGE } from '../src/page';
import { JSON_LD, LIMITS_MD, mdToHtml, prefersMarkdown, SITE_PAGES } from '../src/site';

const get = (path: string, accept?: string) =>
  worker.fetch(new Request(`https://itemized.mortuary.ai${path}`, { headers: accept ? { accept } : {} }), {} as Env, {} as ExecutionContext);

describe('prefersMarkdown', () => {
  it('serves Markdown only when the client ranks it above HTML', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true);
    expect(prefersMarkdown('text/markdown, text/html;q=0.9')).toBe(true);
    expect(prefersMarkdown('text/html, text/markdown;q=0.5')).toBe(false);
    expect(prefersMarkdown('text/markdown;q=0')).toBe(false);
    expect(prefersMarkdown('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(false);
    expect(prefersMarkdown('*/*')).toBe(false);
    expect(prefersMarkdown(undefined)).toBe(false);
  });
});

describe('mdToHtml', () => {
  it('renders headings with ids, lists, bold and links, escaping the rest', () => {
    expect(mdToHtml('## Title {#t}\n\nA **b** [x](https://e.test/a) <i>\n\n- one\n- two')).toBe(
      '<h2 id="t">Title</h2>\n  <p>A <strong>b</strong> <a href="https://e.test/a">x</a> &lt;i&gt;</p>\n  <ul><li>one</li><li>two</li></ul>',
    );
  });

  it('turns the limits paragraphs into tag-free Markdown', () => {
    expect(LIMITS_MD).not.toMatch(/<[a-z]/);
    expect(LIMITS_MD).toContain('**Funeral homes:**');
  });
});

describe('the home page', () => {
  it('keeps the reference sheet and every FTC source link', () => {
    expect(PAGE).toContain('<h2 id="rule-heading">What is the Funeral Rule?</h2>');
    for (const href of ['consumer.ftc.gov/articles/ftc-funeral-rule', 'complying-funeral-rule', '2024/01/ftc-sends-warning-letters', '2020/06/ftc-releases-funeral-home']) {
      expect(PAGE).toContain(href);
    }
  });

  it('serves HTML that search engines may index, with a canonical URL and JSON-LD', async () => {
    const res = await get('/', 'text/html');
    const html = await res.text();
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('vary')).toMatch(/Accept/);
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expect(html).not.toContain('noindex');
    expect(html).toContain('<link rel="canonical" href="https://itemized.mortuary.ai/">');
    const ld = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/)?.[1];
    expect(JSON.parse(ld!)).toEqual(JSON_LD);
  });

  it('serves Markdown to Accept: text/markdown', async () => {
    const res = await get('/', 'text/markdown');
    const md = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('vary')).toBe('Accept');
    expect(md.startsWith('# Itemized\n')).toBe(true);
    expect(md).toContain('## When to use Itemized');
    expect(md).not.toMatch(/\{#|<[a-z]/);
  });

  it('sends the security headers', async () => {
    const res = await get('/');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

describe('the agent files', () => {
  it('serves robots.txt that keeps reviews and the API out and points at the sitemap', async () => {
    const body = await (await get('/robots.txt')).text();
    expect(body).toMatch(/^User-agent: \*$/m);
    expect(body).toMatch(/^Disallow: \/r\/$/m);
    expect(body).toMatch(/^Disallow: \/api\/$/m);
    expect(body).toContain('Sitemap: https://itemized.mortuary.ai/sitemap.xml');
  });

  it('serves llms.txt in the llmstxt.org shape, with when-to-use and how-to-call sections', async () => {
    const res = await get('/llms.txt');
    const body = await res.text();
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(body.split('\n')[0]).toBe('# Itemized');
    expect(body).toMatch(/^> /m);
    expect(body).toContain('## When to use Itemized');
    expect(body).toContain('POST https://itemized.mortuary.ai/api/audits');
  });

  it('serves a sitemap of every indexable page', async () => {
    const res = await get('/sitemap.xml');
    const body = await res.text();
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    for (const p of ['/', '/llms.txt', '/about', '/privacy', '/contact']) expect(body).toContain(`<loc>https://itemized.mortuary.ai${p}</loc>`);
    expect(body).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });
});

describe('the about, privacy and contact pages', () => {
  it.each(SITE_PAGES.map((p) => [p.path]))('%s is indexable HTML with real content, and Markdown on request', async (path) => {
    const res = await get(path);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain('noindex');
    expect(html).toContain(`<link rel="canonical" href="https://itemized.mortuary.ai${path}">`);
    expect(html.replace(/<[^>]+>/g, '').length).toBeGreaterThan(500);
    const md = await get(path, 'text/markdown');
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect((await md.text()).startsWith('# ')).toBe(true);
  });
});

describe('not found', () => {
  it('returns 404 Markdown that points agents somewhere useful', async () => {
    const res = await get('/no-such-page', 'text/markdown');
    const body = await res.text();
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(body).toContain('https://itemized.mortuary.ai/llms.txt');
  });

  it('keeps the HTML 404 for browsers and JSON for the API', async () => {
    const page = await get('/no-such-page', 'text/html');
    expect(page.status).toBe(404);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    const api = await get('/api/nothing', 'text/markdown');
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: 'Not found.' });
  });
});
