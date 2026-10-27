import ruleset from '../prep/rules/ftc-453@2026.1.json';
import { ACCEPTED_TYPES, MAX_PAGES, MAX_UPLOAD_BYTES } from './audit';
import { findingItem, LIMITS_PARAGRAPHS, summarySentence } from './letter';
import { actionsRow, compactLetterhead, FIX_PROMPT_SCRIPT, PDF_SCRIPT } from './review';
import type { Finding } from './rules/types';
import { AUDIENCE, HEADLINE, HERO_LEDE, jsonLdScript, mdToHtml, REFERENCE_MD, SAMPLES } from './site';
import { HEAD_LINKS, MONOGRAM, SITE_FOOTER, socialMeta } from './styles';

const accept = Object.keys(ACCEPTED_TYPES).join(',');
const maxMb = MAX_UPLOAD_BYTES / (1024 * 1024);

// Files are sent in page order. The photo pairs passed the Day 5 bar: no fail their PDF does not have.
const sampleItems = SAMPLES.map(
  (s) => `<li class="sample-row">
        <p class="sample-text"><span class="sample-name">${s.name}</span><span class="sample-note">${s.note}</span></p>
        <p class="sample-actions">${s.versions
          .map((v) => `<button type="button" class="sample" data-files="${v.files.join(' ')}" aria-label="Review the ${v.label === 'PDF' ? 'PDF' : 'photos'} of ${s.name}">${v.label}</button>`)
          .join('')}</p>
      </li>`,
).join('\n      ');

// Two of Bellwether's three findings as the live review prints them (sample syn-03, engine-5); test/site.test.ts
// checks the engine still reaches these verdicts on that list. The letter's own markup draws them.
const check = (id: string) => ruleset.checks.find((c) => c.id === id)!;
const specimenFinding = (id: string, quote: string | null, page: number | null): Finding =>
  ({ checkId: id, verdict: 'fail', title: check(id).title, plain: check(id).plain, cite: check(id).cite, basis: check(id).basis, evidence: { quote, page }, reason: '' }) as Finding;
export const SPECIMEN_FINDINGS = [
  specimenFinding('C-041', 'A. Direct cremation with container provided by the purchaser; B. Direct cremation with a cloth-covered cremation casket', 2),
  specimenFinding('C-030', null, null),
];

// "From your list" in a real letter means the reader's upload; here it would read as their list already reviewed.
const specimenFindings = SPECIMEN_FINDINGS.map(findingItem).join('').replaceAll('From your list', 'From the sample list');

const specimen = `<aside class="sheet specimen" aria-labelledby="specimen-heading">
  <h2 class="specimen-heading" id="specimen-heading">What you get back</h2>
  <p class="specimen-intro">An example review of Bellwether Memorial Chapel, a fictional funeral home.</p>
  <div class="specimen-page">
    <span class="specimen-stamp" aria-hidden="true">Example</span>
    <p class="specimen-house" aria-hidden="true">${MONOGRAM}<span>Itemized</span></p>
    <div class="letter">
      <p class="letter-re">Re: the General Price List of Bellwether Memorial Chapel</p>
      <p class="summary">${summarySentence(3, 0, 34)}</p>
      <section class="group fail"><p class="group-head">Did not pass<span class="count">3</span></p><ul class="findings">${specimenFindings}</ul></section>
    </div>
  </div>
  <p class="specimen-caption">Every finding cites the Rule and quotes the list.
    <button type="button" class="text-btn sample" data-files="syn-03.pdf">Run this example</button></p>
</aside>`;

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Itemized: a Funeral Rule review of General Price Lists</title>
${socialMeta('Itemized: a Funeral Rule review of General Price Lists')}
${HEAD_LINKS}
${jsonLdScript()}
</head>
<body>
<main class="desk">
<section class="sheet intake" aria-labelledby="house-name">
  <header class="letterhead">
    ${MONOGRAM}
    <h1 id="house-name">Itemized</h1>
    <hr class="gilt-hairline">
    <p class="tagline">A Funeral Rule review of General Price Lists</p>
  </header>

  <div class="hero">
    <h2 class="headline">${HEADLINE}</h2>
    <p class="hero-lede">${HERO_LEDE}</p>
    <dl class="audience">
      ${AUDIENCE.map(([who, what]) => `<div><dt>${who}</dt><dd>${what}</dd></div>`).join('\n      ')}
    </dl>
  </div>

  <div class="tabs" role="tablist" aria-label="Choose a list to review">
    <button type="button" role="tab" id="tab-upload" aria-controls="panel-upload" aria-selected="true">Your price list</button>
    <button type="button" role="tab" id="tab-samples" aria-controls="panel-samples" aria-selected="false" tabindex="-1">A sample list</button>
  </div>

  <form id="panel-upload" class="entry" role="tabpanel" aria-labelledby="tab-upload">
    <div class="field" id="field">
      <span class="file-name" id="file-name">Upload the whole list: a PDF, or a photo of each page. Up to ${maxMb} MB each. Drop it here or choose a file.</span>
      <label class="btn" id="choose" for="file">Choose a price list</label>
      <input class="file-input" id="file" type="file" accept="${accept}" multiple aria-label="Your General Price List">
      <ol class="pages" id="pages" aria-label="Pages" aria-live="polite" aria-relevant="additions" hidden></ol>
      <button class="text-btn add-page" id="add-page" type="button" hidden>Add another page</button>
    </div>
    <div class="submit-row">
      <button class="btn btn-primary" id="submit" type="submit" disabled>Review this list</button>
      <p class="fine">Documents are processed by Meta AI models, and Meta may use them to improve its products. Uploaded files and their reviews are deleted 30 days after the file was last uploaded. Upload only price lists you are allowed to share.</p>
    </div>
  </form>

  <section class="samples" id="panel-samples" role="tabpanel" aria-labelledby="tab-samples" hidden>
    <p class="fine">Three fictional funeral homes, written to show what Itemized finds. Each runs through the same review as an upload.</p>
    <ul>
      ${sampleItems}
    </ul>
  </section>

  <div id="progress">
    <p class="status" id="status" role="status" aria-live="polite"></p>
    <span class="engraving" aria-hidden="true"></span>
  </div>
</section>

${specimen}

<section class="sheet review-sheet" id="review" aria-labelledby="letter-re" hidden>
  ${compactLetterhead('p')}
  <article class="letter" id="letter"></article>
  ${actionsRow('', '<a id="permalink" href="/">Open this review on its own page</a>')}
</section>

<section class="sheet postscript reference" aria-labelledby="rule-heading">
  ${mdToHtml(REFERENCE_MD)}
  <section class="limits" aria-labelledby="about-heading">
    <h2 id="about-heading">About these results</h2>
    ${LIMITS_PARAGRAPHS}
  </section>
</section>
</main>
${SITE_FOOTER}
<script>
const form = document.getElementById('panel-upload');
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

// fetch rejects with a TypeError, and a cut-off response fails JSON parsing with a SyntaxError;
// their browser wording ("Failed to fetch") is not for the reader.
function showError(err) {
  progress.classList.remove('working');
  statusEl.classList.add('error');
  statusEl.textContent = err instanceof TypeError || err instanceof SyntaxError
    ? 'Itemized could not be reached. Check your connection and try again.'
    : err.message;
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
    showError(err);
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
      showError(err);
    }
  });
}
// Tabs: the arrow keys, Home and End move between them (ARIA tabs pattern, automatic activation).
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab, false));
  tab.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(tabs[(next + tabs.length) % tabs.length], true);
  });
}
addEventListener('beforeprint', () => { for (const d of letter.querySelectorAll('details')) d.open = true; });
${PDF_SCRIPT}
${FIX_PROMPT_SCRIPT}
</script>
</body>
</html>`;
