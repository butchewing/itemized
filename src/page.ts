import { ACCEPTED_TYPES, MAX_PAGES, MAX_UPLOAD_BYTES } from './audit';
import { LIMITS_PARAGRAPHS } from './letter';
import { actionsRow, compactLetterhead, PDF_SCRIPT } from './review';
import { HEAD_LINKS, MONOGRAM, socialMeta } from './styles';

const accept = Object.keys(ACCEPTED_TYPES).join(',');
const maxMb = MAX_UPLOAD_BYTES / (1024 * 1024);

// Files are sent in page order. The photo pairs passed the Day 5 bar: no fail their PDF does not have.
const SAMPLES = [
  { files: ['syn-01.pdf'], name: 'Juniper Hollow Funeral Home', note: 'A complete list. Expect every check to pass.' },
  { files: ['syn-01-1.jpeg', 'syn-01-2.jpeg'], name: 'Juniper Hollow Funeral Home', note: 'A complete list, photographed (2 pages).' },
  { files: ['syn-03.pdf'], name: 'Bellwether Memorial Chapel', note: 'Missing required statements and options.' },
  { files: ['syn-10.pdf'], name: 'Marrowfield Funeral Home', note: 'Vague pricing and claims a person should review.' },
  {
    files: ['syn-10-1.jpeg', 'syn-10-2.jpeg'],
    name: 'Marrowfield Funeral Home',
    note: 'Vague pricing and claims a person should review, photographed (2 pages).',
  },
];

const sampleItems = SAMPLES.map(
  (s) => `<li><button type="button" class="sample" data-files="${s.files.join(' ')}">
        <span class="sample-name">${s.name}</span>
        <span class="sample-note">${s.note}</span>
        <span class="sample-action">Review</span>
      </button></li>`,
).join('\n      ');

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Itemized: a Funeral Rule review of General Price Lists</title>
${socialMeta('Itemized: a Funeral Rule review of General Price Lists')}
${HEAD_LINKS}
</head>
<body>
<main>
<section class="sheet intake" aria-labelledby="house-name">
  <header class="letterhead">
    ${MONOGRAM}
    <h1 id="house-name">Itemized</h1>
    <hr class="double-rule">
    <p class="tagline">A Funeral Rule review of General Price Lists</p>
    <p class="lede">Upload the General Price List you hand to families. Itemized checks it against the Federal Trade Commission’s Funeral Rule and writes back with what it found, citing the Rule and quoting your list.</p>
  </header>

  <form id="form" class="entry">
    <label class="entry-label" for="file">Your General Price List</label>
    <div class="field" id="field">
      <span class="file-name" id="file-name">Upload the whole list: a PDF, or a photo of each page. Up to ${maxMb} MB each. Drop it here or choose a file.</span>
      <label class="btn" id="choose" for="file">Choose a price list</label>
      <input class="file-input" id="file" type="file" accept="${accept}" multiple>
      <ol class="pages" id="pages" aria-label="Pages" aria-live="polite" aria-relevant="additions" hidden></ol>
      <button class="text-btn add-page" id="add-page" type="button" hidden>Add another page</button>
    </div>
    <div class="submit-row">
      <button class="btn btn-primary" id="submit" type="submit" disabled>Review this list</button>
      <p class="fine">Documents are processed by Meta AI models, and Meta may use them to improve its products. Uploaded files and their reviews are deleted 30 days after the file was last uploaded. Upload only price lists you are allowed to share.</p>
    </div>
  </form>

  <section class="samples" aria-labelledby="samples-heading">
    <h2 id="samples-heading">Or review a sample list</h2>
    <p class="fine">Fictional funeral homes, written to show what Itemized finds.</p>
    <ul>
      ${sampleItems}
    </ul>
  </section>

  <div id="progress">
    <p class="status" id="status" role="status" aria-live="polite"></p>
    <span class="engraving" aria-hidden="true"></span>
  </div>
</section>

<section class="sheet review-sheet" id="review" aria-labelledby="letter-re" hidden>
  ${compactLetterhead('p')}
  <article class="letter" id="letter"></article>
  ${actionsRow('', '<a id="permalink" href="/">Open this review on its own page</a>')}
</section>

<section class="sheet postscript reference" aria-labelledby="rule-heading">
  <h2 id="rule-heading">What is the Funeral Rule?</h2>
  <p>The Funeral Rule is a federal regulation enforced by the Federal Trade Commission. It lets families choose only the funeral goods and services they want, pay only for those, and compare prices between funeral homes. A funeral home must give a General Price List, which the family can keep, showing each item and service it offers and what it costs. The FTC checks compliance with undercover inspections every year.</p>
  <p>Read more from the FTC: <a href="https://consumer.ftc.gov/articles/ftc-funeral-rule">the Funeral Rule for families</a>, <a href="https://www.ftc.gov/news-events/topics/truth-advertising/funeral-rule">the Funeral Rule for funeral providers</a>, and, for funeral homes, the FTC's guide, <a href="https://www.ftc.gov/business-guidance/resources/complying-funeral-rule">Complying with the Funeral Rule</a>.</p>
  <h2>How Itemized helps</h2>
  <p>Itemized reads a General Price List from a PDF or a phone photo and checks it against the Rule's requirements for that list: the required statements, itemized prices, and required options such as direct cremation with an alternative container. Each result cites the section of the Rule it comes from and quotes the part of the list it is based on.</p>
  <p>Itemized reads your list with Meta’s Muse Spark model, then checks it against the Rule with fixed rules written from the Rule’s text. Only those fixed rules can mark a requirement as not passed.</p>
  <p>Funeral homes can use it to check a list before an inspection. Families can use it to understand what a price list should include.</p>
  <section class="limits" aria-labelledby="about-heading">
    <h2 id="about-heading">About these results</h2>
    ${LIMITS_PARAGRAPHS}
  </section>
</section>
</main>
<script>
const form = document.getElementById('form');
const fileInput = document.getElementById('file');
const fileName = document.getElementById('file-name');
const pagesList = document.getElementById('pages');
const addPage = document.getElementById('add-page');
const field = document.getElementById('field');
const submit = document.getElementById('submit');
const statusEl = document.getElementById('status');
const progress = document.getElementById('progress');
const reviewSheet = document.getElementById('review');
const letter = document.getElementById('letter');
const pdfLink = reviewSheet.querySelector('a[data-pdf]');
const pdfStatus = document.getElementById('pdf-status');
const permalink = document.getElementById('permalink');
const samples = [...document.querySelectorAll('.sample')];
const LABELS = {
  queued: 'Your list is in line to be read.',
  extracting: 'Reading your list, line by line. This takes up to about thirty seconds.',
  checking: 'Checking each line against the Funeral Rule.',
};
const FAILURES = {
  'daily budget reached': 'Itemized has reached its review limit for today. Please try again tomorrow.',
  'PDF not supported on open-weights yet': 'This list could not be read. Try a photo of each page instead.',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// The list to send, in page order: one PDF, or page images.
let chosen = [];
let appending = false;
let pageIds = 0;
const MAX_PAGES = ${MAX_PAGES};
const isPdf = (f) => f.type === 'application/pdf';
const hasPages = () => chosen.length > 0 && !isPdf(chosen[0]);

function setBusy(busy, message) {
  submit.disabled = busy || !chosen.length;
  for (const s of samples) s.disabled = busy;
  progress.classList.toggle('working', busy);
  statusEl.classList.remove('error');
  statusEl.textContent = message || '';
}

function showError(message) {
  progress.classList.remove('working');
  statusEl.classList.add('error');
  statusEl.textContent = message;
}

function pageItem() {
  const li = document.createElement('li');
  const label = document.createElement('span');
  label.id = 'page-' + ++pageIds;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-btn';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-describedby', label.id);
  remove.addEventListener('click', () => removePage(li));
  li.append(label, remove);
  return li;
}

function renumber() {
  [...pagesList.children].forEach((li, i) => { li.firstChild.textContent = 'Page ' + (i + 1) + ': ' + chosen[i].name; });
}

function showChosen() {
  const pages = hasPages();
  fileName.hidden = pages;
  fileName.textContent = chosen.length && !pages ? chosen[0].name : fileName.dataset.empty;
  fileName.classList.toggle('chosen', chosen.length > 0);
  field.classList.toggle('has-pages', pages);
  pagesList.hidden = !pages;
  addPage.hidden = !pages || chosen.length >= MAX_PAGES;
  submit.disabled = !chosen.length;
}

// A PDF replaces the list. Images extend it when adding, and start a new one otherwise.
function choose(files, append) {
  files = [...files];
  if (!files.length) return;
  const pdf = files.find(isPdf);
  const extend = append && hasPages() && !pdf;
  chosen = pdf ? [pdf] : extend ? chosen.concat(files) : files;
  if (!extend) pagesList.replaceChildren();
  if (hasPages()) {
    while (pagesList.children.length < chosen.length) pagesList.append(pageItem());
    renumber();
  }
  showChosen();
}

function removePage(li) {
  const items = [...pagesList.children];
  const i = items.indexOf(li);
  chosen.splice(i, 1);
  li.remove();
  renumber();
  showChosen();
  const next = pagesList.children[Math.min(i, pagesList.children.length - 1)];
  (next ? next.querySelector('button') : addPage.hidden ? fileInput : addPage).focus();
}
fileName.dataset.empty = fileName.textContent;

function hideReview() {
  reviewSheet.hidden = true;
  document.body.classList.remove('has-review');
  letter.replaceChildren();
}

// The letter HTML is rendered and escaped on the server, the same markup as /r/:id and the PDF.
function showReview(id, html) {
  letter.innerHTML = html;
  pdfLink.href = '/r/' + id + '/pdf';
  permalink.href = '/r/' + id;
  pdfStatus.replaceChildren();
  pdfStatus.classList.remove('error');
  reviewSheet.hidden = false;
  // The review carries the limits as its postscript; the reference copy would repeat them right below.
  document.body.classList.add('has-review');
  document.getElementById('letter-re').focus({ preventScroll: true });
  reviewSheet.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
}

async function review(formData) {
  hideReview();
  setBusy(true, 'Sending your list.');
  try {
    const res = await fetch('/api/audits', { method: 'POST', body: formData });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error('Too many reviews in a short time. Please wait a minute and try again.');
    if (!res.ok) throw new Error(body.error || 'The list could not be sent. Please try again.');
    for (;;) {
      await sleep(1500);
      const audit = await (await fetch('/api/audits/' + body.id)).json();
      if (audit.status === 'done' && audit.report) {
        const letterRes = await fetch('/api/audits/' + body.id + '/letter');
        if (!letterRes.ok) throw new Error('The review is ready but could not be shown. Please try again.');
        const { html } = await letterRes.json();
        setBusy(false, 'Your review is ready below.');
        showReview(body.id, html);
        return;
      }
      if (audit.status === 'failed') throw new Error(FAILURES[audit.error] || 'Itemized could not finish reading this list. Please try again, or try a clearer copy.');
      statusEl.textContent = LABELS[audit.status] || statusEl.textContent;
    }
  } catch (err) {
    setBusy(false);
    showError(err.message);
  }
}

document.getElementById('choose').addEventListener('click', () => { appending = false; });
addPage.addEventListener('click', () => { appending = true; fileInput.click(); });
fileInput.addEventListener('cancel', () => { appending = false; });
fileInput.addEventListener('change', () => {
  choose(fileInput.files, appending);
  appending = false;
  fileInput.value = '';
});
for (const type of ['dragenter', 'dragover']) field.addEventListener(type, (e) => { e.preventDefault(); field.classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) field.addEventListener(type, () => field.classList.remove('dragging'));
field.addEventListener('drop', (e) => {
  e.preventDefault();
  choose(e.dataTransfer.files, true);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!chosen.length) return;
  const data = new FormData();
  for (const f of chosen) data.append('file', f, f.name);
  review(data);
});

for (const button of samples) {
  button.addEventListener('click', async () => {
    hideReview();
    setBusy(true, 'Opening the sample list.');
    try {
      const data = new FormData();
      for (const file of button.dataset.files.split(' ')) {
        const res = await fetch('/samples/' + file);
        if (!res.ok) throw new Error('The sample list could not be opened.');
        const type = file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
        data.append('file', new File([await res.blob()], file, { type }));
      }
      review(data);
    } catch (err) {
      setBusy(false);
      showError(err.message);
    }
  });
}
addEventListener('beforeprint', () => { for (const d of letter.querySelectorAll('details')) d.open = true; });
${PDF_SCRIPT}
</script>
</body>
</html>`;
