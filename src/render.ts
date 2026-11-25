import puppeteer from '@cloudflare/puppeteer';
// Bundled as text (wrangler "rules": Text) so the remote browser never fetches code from anywhere.
import PDFJS_SOURCE from 'pdfjs-dist/build/pdf.min.mjs';
import PDFJS_WORKER_SOURCE from 'pdfjs-dist/build/pdf.worker.min.mjs';

// PDFs go to models that read images only as page images rendered here, the way the eval's set d was
// made: 150 DPI, grayscale. Bump RENDER_VERSION when the output changes, so cached reads are not reused.
export const RENDER_VERSION = 'pdfjs-6.5.438@150dpi-gray';
export const RENDER_DPI = 150;
export const MAX_RENDER_PAGES = 24;
// The upload is untrusted: a render that runs this long is abandoned.
const RENDER_TIMEOUT_MS = 90_000;
// Chunks keep each DevTools message small while the PDF is copied into the page.
const CHUNK_BYTES = 512 * 1024;

export type RenderedPdf = {
  pages: { bytes: ArrayBuffer; contentType: 'image/png' }[];
  // Characters in each page's text layer; a page with none was scanned or drawn as an image.
  textChars: number[];
};

export class RenderFailure extends Error {}

const toBase64 = (u8: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
};

const fromBase64 = (b64: string) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

export async function renderPdf(browserBinding: Env['BROWSER'], pdf: ArrayBuffer): Promise<RenderedPdf> {
  const browser = await puppeteer.launch(browserBinding);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      const page = await browser.newPage();
      // Nothing may load over the network: pdf.js arrives inline and the PDF through evaluate().
      await page.setRequestInterception(true);
      page.on('request', (r) => {
        const url = r.url();
        if (url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:')) void r.continue();
        else void r.abort();
      });
      await page.setContent('<!DOCTYPE html><html><body></body></html>');

      const u8 = new Uint8Array(pdf);
      await page.evaluate(() => {
        (globalThis as unknown as { __pdf: string[] }).__pdf = [];
      });
      for (let i = 0; i < u8.length; i += CHUNK_BYTES) {
        const chunk = toBase64(u8.subarray(i, i + CHUNK_BYTES));
        await page.evaluate((c: string) => {
          (globalThis as unknown as { __pdf: string[] }).__pdf.push(c);
        }, chunk);
      }

      const opened = await page.evaluate(
        async (lib: string, worker: string, maxPages: number) => {
          const g = globalThis as unknown as Record<string, unknown> & { __pdf: string[] };
          const url = (src: string) => URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
          const pdfjs = await import(url(lib));
          pdfjs.GlobalWorkerOptions.workerSrc = url(worker);
          const bin = atob(g.__pdf.join(''));
          g.__pdf = [];
          const data = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
          try {
            const doc = await pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false, disableAutoFetch: true }).promise;
            g.__doc = doc;
            return { pages: doc.numPages as number, error: doc.numPages > maxPages ? 'too_many_pages' : null };
          } catch (e) {
            return { pages: 0, error: e instanceof Error ? `${e.name}: ${e.message}` : 'unreadable' };
          }
        },
        PDFJS_SOURCE,
        PDFJS_WORKER_SOURCE,
        MAX_RENDER_PAGES,
      );
      if (opened.error === 'too_many_pages') throw new RenderFailure(`PDF has ${opened.pages} pages; the most this model can read is ${MAX_RENDER_PAGES}`);
      if (opened.error || !opened.pages) throw new RenderFailure(`PDF could not be opened (${opened.error ?? 'no pages'})`);

      const out: RenderedPdf = { pages: [], textChars: [] };
      for (let n = 1; n <= opened.pages; n++) {
        const r = await page.evaluate(
          async (pageNumber: number, dpi: number) => {
            const doc = (globalThis as unknown as { __doc: { getPage(n: number): Promise<any> } }).__doc;
            const p = await doc.getPage(pageNumber);
            const text = await p.getTextContent();
            const chars = text.items.reduce((sum: number, it: { str?: string }) => sum + (it.str ?? '').trim().length, 0);
            const viewport = p.getViewport({ scale: dpi / 72 });
            // This function runs in the page, where the DOM exists; the Worker's types do not include it.
            const canvas = (globalThis as any).document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await p.render({ canvasContext: ctx, canvas, viewport }).promise;
            // Grayscale, like the eval's renders (Rec. 601 luma).
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
              const y = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
              d[i] = d[i + 1] = d[i + 2] = y;
            }
            ctx.putImageData(img, 0, 0);
            p.cleanup();
            const blob: Blob = await new Promise((ok) => canvas.toBlob((b: Blob | null) => ok(b!), 'image/png'));
            const buf = new Uint8Array(await blob.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            return { png: btoa(bin), chars };
          },
          n,
          RENDER_DPI,
        );
        out.pages.push({ bytes: fromBase64(r.png), contentType: 'image/png' });
        out.textChars.push(r.chars);
      }
      return out;
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RenderFailure('PDF took too long to render')), RENDER_TIMEOUT_MS);
    });
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}
