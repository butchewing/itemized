import { escapeHtml, fileStem } from './letter';
import { mdToHtml, type SitePage } from './site';
import { HEAD_LINKS, MONOGRAM, SITE_FOOTER, socialMeta } from './styles';

// The house mark that heads every review sheet. The standalone page makes it its h1.
export const compactLetterhead = (tag: 'h1' | 'p') => `<header class="letterhead letterhead-compact">
    ${MONOGRAM}
    <${tag} class="house">Itemized</${tag}>
    <hr class="gilt-hairline">
  </header>`;

export const PDF_FAILED = 'The PDF could not be made right now. You can print this review from its own page instead.';

// Progressive enhancement for a[data-pdf]: without it the link still downloads the PDF,
// but a 429 or 503 would replace the page with JSON.
export const PDF_SCRIPT = `
for (const link of document.querySelectorAll('a[data-pdf]')) {
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    const out = document.getElementById(link.dataset.pdf);
    const say = (text, isError) => { out.replaceChildren(text); out.classList.toggle('error', !!isError); };
    if (link.getAttribute('aria-disabled') === 'true') return;
    link.setAttribute('aria-disabled', 'true');
    say('Preparing the PDF. This can take a few seconds.');
    try {
      const res = await fetch(link.href);
      if (res.status === 429) return say('Too many PDFs in a short time. Please wait a minute and try again.', true);
      if (!res.ok) {
        say('The PDF could not be made right now. You can print this review from ', true);
        const page = document.createElement('a');
        page.href = link.href.replace(/\\/pdf$/, '');
        page.textContent = 'its own page';
        out.append(page, ' instead.');
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name ? name[1] : 'itemized-review.pdf';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      say('The PDF has downloaded.');
    } catch {
      say('The PDF could not be downloaded. Check your connection and try again.', true);
    } finally {
      link.removeAttribute('aria-disabled');
    }
  });
}`;

// Delegated from document because on / the letter is inserted after this script runs.
// The <pre> is the one copy of the text; textContent undoes the HTML escaping.
export const FIX_PROMPT_SCRIPT = `
document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-fix-prompt]');
  if (!button) return;
  const pre = document.getElementById('fix-prompt-text');
  const out = document.getElementById('fix-prompt-status');
  const text = pre.textContent;
  if (button.dataset.fixPrompt === 'download') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = button.dataset.filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }
  out.replaceChildren();
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    getSelection().selectAllChildren(pre);
    copied = document.execCommand('copy');
  }
  // Cleared first so a second copy is announced again.
  if (copied) setTimeout(() => { out.textContent = 'Copied'; }, 50);
});`;

export const actionsRow = (id: string, second: string) => `<div class="actions">
    <a class="btn btn-primary" href="/r/${escapeHtml(id)}/pdf" download data-pdf="pdf-status">Download PDF</a>
    ${second}
    <p class="actions-status" id="pdf-status" role="status" aria-live="polite"></p>
  </div>`;

// Reviews and error pages stay out of search; the about, privacy and contact pages are indexed.
const shell = (title: string, body: string, path = '/', index = false) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${index ? '' : '<meta name="robots" content="noindex, nofollow">\n'}<title>${escapeHtml(title)}</title>
${socialMeta(index ? title : 'Itemized: a Funeral Rule review of General Price Lists', path)}
${HEAD_LINKS}
</head>
<body>
${body}
</body>
</html>`;

export function reviewPage(id: string, letterHtml: string, provider: string | null): string {
  return shell(
    provider ? `Itemized: the General Price List of ${provider}` : 'Itemized: a review of your General Price List',
    `<main class="sheet review-sheet">
  ${compactLetterhead('h1')}
  <article class="letter" aria-labelledby="letter-re">${letterHtml}</article>
  ${actionsRow(id, '<a href="/">Review another list</a>')}
</main>
<script>
${PDF_SCRIPT}
${FIX_PROMPT_SCRIPT}
addEventListener('beforeprint', () => { for (const d of document.querySelectorAll('details')) d.open = true; });
</script>`,
    `/r/${id}`,
  );
}

const NOT_FOUND = {
  review: ['Itemized: review not found', 'This review could not be found.', 'It may still be in progress, or the link may be incomplete.'],
  page: ['Itemized: page not found', 'This page could not be found.', 'The link may be incomplete or out of date.'],
} as const;

export const notFoundPage = (kind: keyof typeof NOT_FOUND = 'review') =>
  shell(
    NOT_FOUND[kind][0],
    `<main class="sheet review-sheet">
  ${compactLetterhead('h1')}
  <div class="letter">
    <h2 class="letter-re">${NOT_FOUND[kind][1]}</h2>
    <p class="summary">${NOT_FOUND[kind][2]}</p>
    <p><a href="/">Review a General Price List</a></p>
  </div>
</main>`,
  );

export const sitePage = (p: SitePage) =>
  shell(
    p.title,
    `<main class="sheet postscript site-page" aria-labelledby="page-heading">
  ${compactLetterhead('p')}
  <h1 id="page-heading">${escapeHtml(p.heading)}</h1>
  ${mdToHtml(p.md)}
</main>
${SITE_FOOTER}`,
    p.path,
    true,
  );

export const pdfFilename = (provider: string | null, date: Date) => `itemized-review-${fileStem(provider, date)}.pdf`;
