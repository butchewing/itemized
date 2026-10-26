import ruleset from '../prep/rules/ftc-453@2026.1.json';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from './audit';

const accept = Object.keys(ACCEPTED_TYPES).join(',');
const maxMb = MAX_UPLOAD_BYTES / (1024 * 1024);
// Inlined into a <script>; escaping "<" keeps ruleset text from closing the tag.
const basisJson = JSON.stringify(ruleset.basis_values).replace(/</g, '\\u003c');

const SAMPLES = [
  { file: 'syn-01.pdf', name: 'Juniper Hollow Funeral Home', note: 'A complete list. Expect every check to pass.' },
  { file: 'syn-03.pdf', name: 'Bellwether Memorial Chapel', note: 'Missing required statements and options.' },
  { file: 'syn-10.pdf', name: 'Marrowfield Funeral Home', note: 'Vague pricing and claims a person should review.' },
];

const sampleItems = SAMPLES.map(
  (s) => `<li><button type="button" class="sample" data-file="${s.file}">
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
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cellipse cx='16' cy='16' rx='14' ry='15' fill='%23ffffff' stroke='%23a8864a' stroke-width='1.5'/%3E%3Cpath d='M12 9h8M12 23h8M16 9v14' stroke='%2320262e' stroke-width='2.2' fill='none'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap">
<style>
  :root {
    --ground: #e9ecef;
    --sheet: #ffffff;
    --ink: #20262e;
    --slate: #556375;
    --rule: #d5dae0;
    --gilt: #a8864a;
    --gilt-soft: #e7dcc6;
    --oxblood: #8a2b22;
    --engraved: 'Cinzel', 'Trajan Pro', Georgia, serif;
    --text: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    color-scheme: light;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { background: var(--ground); }
  body {
    margin: 0;
    min-height: 100vh;
    font: 400 1.0625rem/1.6 var(--text);
    font-optical-sizing: auto;
    color: var(--ink);
    caret-color: var(--ink);
    background:
      repeating-linear-gradient(90deg, rgba(32, 38, 46, .018) 0 1px, transparent 1px 7px),
      var(--ground);
    padding: clamp(1rem, 4vw, 3.5rem) clamp(.75rem, 3vw, 2rem) 4rem;
  }
  ::selection { background: var(--gilt-soft); color: var(--ink); }
  a { color: inherit; text-decoration-color: var(--gilt); text-underline-offset: .2em; text-decoration-thickness: 1px; }
  a:hover { text-decoration-thickness: 2px; }
  :focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }

  .sheet {
    max-width: 44rem;
    margin: 0 auto;
    background: var(--sheet);
    padding: clamp(1.75rem, 6vw, 4rem) clamp(1.25rem, 6vw, 4.5rem) clamp(2rem, 6vw, 4rem);
    box-shadow: 0 1px 2px rgba(32, 38, 46, .06), 0 18px 40px -18px rgba(32, 38, 46, .28);
  }

  .letterhead { text-align: center; }
  .monogram { display: block; width: 3.5rem; height: 3.5rem; margin: 0 auto 1rem; fill: none; stroke: var(--gilt); stroke-linecap: square; }
  h1 {
    margin: 0;
    font: 600 clamp(2rem, 5.2vw, 2.75rem)/1 var(--engraved);
    letter-spacing: .2em;
    padding-left: .2em;
  }
  .double-rule { width: min(15rem, 60%); margin: 1rem auto .85rem; border: 0; border-top: 1px solid var(--gilt); }
  .tagline { margin: 0; font-variant-caps: all-small-caps; letter-spacing: .12em; color: var(--slate); font-size: 1.05rem; }
  .lede { max-width: 33rem; margin: 1.75rem auto 0; text-align: center; font-size: 1.1rem; }

  .entry { margin-top: 2.5rem; }
  .entry-label { display: block; font: 500 .8rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; margin-bottom: .6rem; }
  .field {
    display: grid; grid-template-columns: 1fr auto; gap: .75rem 1rem; align-items: center;
    padding: 1.1rem 1.25rem; border: 1px solid var(--rule); outline: 1px solid transparent; outline-offset: 4px;
    transition: border-color .2s ease-out, outline-color .2s ease-out, background-color .2s ease-out;
  }
  .field.dragging { border-color: var(--gilt); outline-color: var(--gilt-soft); background: #fbfaf7; }
  .file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .file-name { font-style: italic; color: var(--slate); min-width: 0; overflow-wrap: anywhere; }
  .file-name.chosen { font-style: normal; color: var(--ink); }
  .btn {
    font: 500 .8rem/1 var(--engraved); letter-spacing: .16em; text-transform: uppercase;
    color: var(--ink); background: transparent; border: 1px solid var(--ink);
    padding: .85rem 1.15rem .8rem; cursor: pointer; white-space: nowrap;
    transition: background-color .18s ease-out, color .18s ease-out;
  }
  .btn:hover:not(:disabled) { background: var(--ink); color: var(--sheet); }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .btn-primary { background: var(--ink); color: var(--sheet); }
  .btn-primary:hover:not(:disabled) { background: #000; }
  .btn-primary:disabled { background: transparent; color: var(--slate); border-color: var(--rule); opacity: 1; }
  .submit-row { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; align-items: center; margin-top: 1rem; }
  .fine { font-size: .9rem; color: var(--slate); margin: 0; }

  .samples { margin-top: 2.5rem; }
  .samples h2 { font: 500 .8rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; margin: 0 0 .35rem; }
  .samples .fine { margin-bottom: .5rem; }
  .samples ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
  .sample {
    display: grid; grid-template-columns: 1fr auto; column-gap: 1rem; width: 100%; text-align: left;
    font: inherit; color: inherit; background: none; border: 0; border-bottom: 1px solid var(--rule);
    padding: .85rem .25rem; cursor: pointer; transition: background-color .18s ease-out;
  }
  .sample:hover:not(:disabled) { background: #f7f8f9; }
  .sample:disabled { cursor: not-allowed; opacity: .5; }
  .sample-name { font-weight: 600; }
  .sample-note { grid-column: 1; color: var(--slate); font-size: .95rem; }
  .sample-action { grid-column: 2; grid-row: 1 / span 2; align-self: center; font: 500 .75rem/1 var(--engraved); letter-spacing: .16em; text-transform: uppercase; border-bottom: 1px solid var(--gilt); padding-bottom: .2rem; }

  .status { margin: 2rem 0 0; min-height: 1.6em; font-style: italic; color: var(--slate); text-align: center; }
  .status.error { color: var(--oxblood); font-style: normal; }
  .engraving { display: block; height: 1px; width: min(12rem, 50%); margin: .6rem auto 0; background: var(--gilt); transform-origin: left; transform: scaleX(0); }
  .working .engraving { animation: engrave 1.6s cubic-bezier(.16, 1, .3, 1) infinite; }
  @keyframes engrave { 0% { transform: scaleX(0); opacity: 1; } 70% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }

  .letter { margin-top: 3rem; padding-top: 2.25rem; border-top: 1px solid var(--ink); }
  .letter[hidden] { display: none; }
  .letter-date { text-align: right; color: var(--slate); margin: 0; font-variant-numeric: oldstyle-nums; }
  .letter-re { margin: 1.25rem 0 0; font: 600 1.15rem/1.35 var(--text); }
  .letter-re:focus { outline: none; }
  .letter-re:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; }
  .summary { margin: .75rem 0 0; }
  .summary strong { font-variant-numeric: lining-nums tabular-nums; }
  .group { margin-top: 2.25rem; }
  .group > h3 { font: 500 .85rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; margin: 0; padding-bottom: .55rem; border-bottom: 1px solid var(--ink); display: flex; justify-content: space-between; gap: 1rem; }
  .group > h3 .count { font-family: var(--text); font-variant-numeric: lining-nums tabular-nums; letter-spacing: 0; text-transform: none; color: var(--slate); }
  .findings { list-style: none; margin: 0; padding: 0; }
  .finding { display: grid; grid-template-columns: minmax(0, 1fr) 9.5rem; gap: .25rem 1.5rem; padding: 1.1rem 0 1.2rem; border-bottom: 1px solid var(--rule); }
  .finding h4 { margin: 0; font: 600 1.05rem/1.35 var(--text); }
  .finding .plain { margin: .3rem 0 0; }
  .finding blockquote { margin: .7rem 0 0; padding: .1rem 0 .1rem 1rem; border-left: 1px solid var(--gilt); font-style: italic; white-space: pre-wrap; overflow-wrap: anywhere; }
  .finding .from { display: block; margin-top: .25rem; font-style: normal; font-variant-caps: all-small-caps; letter-spacing: .08em; color: var(--slate); font-size: .95rem; }
  .finding .review-note { margin: .6rem 0 0; color: var(--slate); font-size: .95rem; }
  .margin { grid-column: 2; grid-row: 1 / span 4; font-size: .85rem; line-height: 1.45; color: var(--slate); padding-top: .15rem; }
  details.group > summary { cursor: pointer; font: 500 .85rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; padding-bottom: .55rem; border-bottom: 1px solid var(--rule); list-style-position: inside; }
  details.group > summary::marker { color: var(--gilt); }
  .simple { list-style: none; margin: 0; padding: 0; }
  .simple li { display: flex; justify-content: space-between; gap: 1rem; padding: .55rem 0; border-bottom: 1px solid var(--rule); }
  .simple .cite { color: var(--slate); font-size: .85rem; text-align: right; }
  .closing { margin-top: 2.25rem; color: var(--slate); font-size: .95rem; }
  .closing p { margin: .35rem 0; }

  .postscript { margin-top: 3.5rem; padding-top: 1.75rem; border-top: 1px solid var(--rule); font-size: .95rem; }
  .postscript h2 { font: 500 .8rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; margin: 1.75rem 0 .5rem; }
  .postscript h2:first-child { margin-top: 0; }
  .postscript p { margin: .5rem 0; max-width: 65ch; }
  .limits { margin-top: 2.75rem; padding-top: 1.5rem; border-top: 1px solid var(--gilt); }
  .limits h2 { margin-top: 0; }
  .signature { margin: 2.5rem 0 .4rem; font: 600 1.1rem/1 var(--engraved); letter-spacing: .2em; color: var(--ink); }
  .signature::before { content: ''; display: block; width: 9rem; border-top: 1px solid var(--ink); margin-bottom: .7rem; }

  @media (max-width: 34rem) {
    .field { grid-template-columns: 1fr; }
    .field .btn { justify-self: start; }
    .finding { grid-template-columns: 1fr; }
    .margin { grid-column: 1; grid-row: auto; padding: .5rem 0 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
    .working .engraving { transform: scaleX(1); }
  }
</style>
</head>
<body>
<main class="sheet">
  <header class="letterhead">
    <svg class="monogram" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <ellipse cx="28" cy="28" rx="25.5" ry="26.5" stroke-width="1"/>
      <ellipse cx="28" cy="28" rx="22.5" ry="23.5" stroke-width=".5"/>
      <path d="M22 16.5h12M22 39.5h12M26 16.5v23M30 16.5v23M27 17v22M28 17v22M29 17v22" stroke-width="1"/>
    </svg>
    <h1>Itemized</h1>
    <hr class="double-rule">
    <p class="tagline">A Funeral Rule review of General Price Lists</p>
    <p class="lede">Upload the General Price List you hand to families. Itemized checks it against the FTC Funeral Rule and writes back with what it found, citing the Rule and quoting your list.</p>
  </header>

  <form id="form" class="entry">
    <label class="entry-label" for="file">Your General Price List</label>
    <div class="field" id="field">
      <span class="file-name" id="file-name">Upload the whole list. A PDF is best; a phone photo works for a one-page list. Up to ${maxMb} MB. Drop it here or choose a file.</span>
      <label class="btn" for="file">Choose a price list</label>
      <input class="file-input" id="file" name="file" type="file" accept="${accept}" required>
    </div>
    <div class="submit-row">
      <button class="btn btn-primary" id="submit" type="submit" disabled>Review this list</button>
      <p class="fine">Documents are processed by Meta AI models, and Meta may use them to improve its products. Uploaded files are deleted after 30 days. Upload only price lists you are allowed to share.</p>
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

  <section class="letter" id="letter" aria-labelledby="letter-re" hidden>
    <p class="letter-date" id="letter-date"></p>
    <h2 class="letter-re" id="letter-re" tabindex="-1"></h2>
    <p class="summary" id="summary"></p>
    <div id="letter-body"></div>
    <div class="closing" id="closing"></div>
  </section>

  <footer class="postscript">
    <h2 id="rule-heading">What is the Funeral Rule?</h2>
    <p>The Funeral Rule is a federal regulation enforced by the Federal Trade Commission. It lets families choose only the funeral goods and services they want, pay only for those, and compare prices between funeral homes. A funeral home must give a General Price List, which the family can keep, showing each item and service it offers and what it costs. The FTC checks compliance with undercover inspections every year.</p>
    <p>Read more from the FTC: <a href="https://consumer.ftc.gov/articles/ftc-funeral-rule">the Funeral Rule for families</a>, <a href="https://www.ftc.gov/news-events/topics/truth-advertising/funeral-rule">the Funeral Rule for funeral providers</a>, and, for funeral homes, the FTC's guide, <a href="https://www.ftc.gov/business-guidance/resources/complying-funeral-rule">Complying with the Funeral Rule</a>.</p>
    <h2>How Itemized helps</h2>
    <p>Itemized reads a General Price List from a PDF or a phone photo and checks it against the Rule's requirements for that list: the required statements, itemized prices, and required options such as direct cremation with an alternative container. Each result cites the section of the Rule it comes from and quotes the part of the list it is based on.</p>
    <p>Funeral homes can use it to check a list before an inspection. Families can use it to understand what a price list should include.</p>
    <section class="limits" aria-labelledby="about-heading">
      <h2 id="about-heading">About these results</h2>
      <p>Itemized is an automated, AI-assisted check of a General Price List against the federal FTC Funeral Rule (16 CFR Part 453). It does not check state law, such as Texas Funeral Service Commission rules. It does not check the Casket Price List, the Outer Burial Container Price List or the Statement of Funeral Goods and Services Selected.</p>
      <p>The AI can misread documents, especially photos. These results are not legal advice and are not a finding that anyone broke the law.</p>
      <p><strong>Funeral homes:</strong> confirm any result with your attorney or your state funeral regulator before acting on it.</p>
      <p><strong>Families:</strong> if something here concerns you, ask the funeral home about it. You can also contact the Federal Trade Commission or the state agency that licenses funeral homes.</p>
    </section>
  </footer>
</main>
<script>
const form = document.getElementById('form');
const fileInput = document.getElementById('file');
const fileName = document.getElementById('file-name');
const field = document.getElementById('field');
const submit = document.getElementById('submit');
const statusEl = document.getElementById('status');
const progress = document.getElementById('progress');
const letter = document.getElementById('letter');
const samples = [...document.querySelectorAll('.sample')];
const BASIS = ${basisJson};
const LABELS = {
  queued: 'Your list is in line to be read.',
  extracting: 'Reading your list, line by line. This takes about fifteen seconds.',
  checking: 'Checking each line against the Funeral Rule.',
};
const FAILURES = {
  'daily budget reached': 'Itemized has reached its review limit for today. Please try again tomorrow.',
  'PDF not supported on open-weights yet': 'This list could not be read. Try a photo of each page instead.',
};
const GROUPS = [
  ['fail', 'Did not pass'],
  ['review', 'Needs a person’s review'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function setBusy(busy, message) {
  submit.disabled = busy || !fileInput.files.length;
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

function showFile(file) {
  fileName.textContent = file ? file.name : fileName.dataset.empty;
  fileName.classList.toggle('chosen', !!file);
  submit.disabled = !file;
}
fileName.dataset.empty = fileName.textContent;

function cite(f) {
  return f.cite || BASIS[f.basis] || '';
}

function findingItem(f) {
  const li = el('li', null, 'finding');
  li.append(el('h4', f.title));
  // Ruleset plain text sometimes describes the problem, so it is shown only where the check did not pass.
  li.append(el('p', f.plain, 'plain'));
  if (f.evidence && f.evidence.quote) {
    const q = el('blockquote', f.evidence.quote);
    q.append(el('span', f.evidence.page ? 'From your list, page ' + f.evidence.page : 'From your list', 'from'));
    li.append(q);
  }
  if (f.verdict === 'review') li.append(el('p', 'Itemized could not read or match this part of the list clearly enough to decide. A person should check it.', 'review-note'));
  const margin = el('div', cite(f), 'margin');
  li.append(margin);
  return li;
}

function simpleList(items) {
  const ul = el('ul', null, 'simple');
  for (const f of items) {
    const li = el('li');
    li.append(el('span', f.title));
    li.append(el('span', cite(f), 'cite'));
    ul.append(li);
  }
  return ul;
}

function renderLetter(audit) {
  const report = audit.report;
  const provider = audit.extraction && audit.extraction.providerName;
  const body = document.getElementById('letter-body');
  body.replaceChildren();
  document.getElementById('letter-date').textContent = today();
  document.getElementById('letter-re').textContent = 'Re: ' + (provider ? 'the General Price List of ' + provider : 'your General Price List');
  const c = report.counts;
  const ran = c.fail + c.review + c.pass;
  const summary = document.getElementById('summary');
  summary.replaceChildren();
  const parts = [[c.fail, ' did not pass, '], [c.review, (c.review === 1 ? ' needs' : ' need') + ' a person’s review, and '], [c.pass, ' passed.']];
  summary.append('Of the ' + ran + ' checks Itemized could run on this list, ');
  for (const [n, text] of parts) { summary.append(el('strong', String(n))); summary.append(text); }

  for (const [verdict, label] of GROUPS) {
    const items = report.findings.filter((f) => f.verdict === verdict);
    if (!items.length) continue;
    const group = el('section', null, 'group ' + verdict);
    const h = el('h3', label);
    h.append(el('span', String(items.length), 'count'));
    group.append(h);
    const ul = el('ul', null, 'findings');
    for (const f of items) ul.append(findingItem(f));
    group.append(ul);
    body.append(group);
  }
  for (const [verdict, label] of [['pass', 'Passed'], ['not_applicable', 'Not applicable to this list']]) {
    const items = report.findings.filter((f) => f.verdict === verdict);
    if (!items.length) continue;
    const details = el('details', null, 'group');
    details.append(el('summary', label + ' (' + items.length + ')'));
    details.append(simpleList(items));
    body.append(details);
  }

  const closing = document.getElementById('closing');
  closing.replaceChildren();
  closing.append(el('p', 'Itemized', 'signature'));
  closing.append(el('p', 'Checked against the FTC Funeral Rule, ruleset ' + report.rulesetId + '@' + report.rulesetVersion + ', on ' + today() + '.'));
  if (report.notRun && report.notRun.length) closing.append(el('p', report.notRun.length + ' further checks that need judgment about wording and placement are not part of this review yet.'));
  letter.hidden = false;
  document.getElementById('letter-re').focus();
}

async function review(formData) {
  letter.hidden = true;
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
        setBusy(false, 'Your review is ready below.');
        renderLetter(audit);
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

fileInput.addEventListener('change', () => showFile(fileInput.files[0]));
for (const type of ['dragenter', 'dragover']) field.addEventListener(type, (e) => { e.preventDefault(); field.classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) field.addEventListener(type, () => field.classList.remove('dragging'));
field.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!e.dataTransfer.files.length) return;
  fileInput.files = e.dataTransfer.files;
  showFile(fileInput.files[0]);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (fileInput.files.length) review(new FormData(form));
});

for (const button of samples) {
  button.addEventListener('click', async () => {
    const file = button.dataset.file;
    letter.hidden = true;
    setBusy(true, 'Opening the sample list.');
    try {
      const res = await fetch('/samples/' + file);
      if (!res.ok) throw new Error('The sample list could not be opened.');
      const data = new FormData();
      data.append('file', new File([await res.blob()], file, { type: 'application/pdf' }));
      review(data);
    } catch (err) {
      setBusy(false);
      showError(err.message);
    }
  });
}
</script>
</body>
</html>`;
