import ruleset from '../prep/rules/ftc-453@2026.1.json';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from './audit';

const accept = Object.keys(ACCEPTED_TYPES).join(',');
const maxMb = MAX_UPLOAD_BYTES / (1024 * 1024);
// Inlined into a <script>; escaping "<" keeps ruleset text from closing the tag.
const basisJson = JSON.stringify(ruleset.basis_values).replace(/</g, '\\u003c');

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Itemized</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
  body { max-width: 36rem; margin: 2rem auto; padding: 0 1rem; }
  label { display: block; font-weight: 600; margin-bottom: .5rem; }
  input[type=file] { display: block; margin-bottom: 1rem; max-width: 100%; }
  button { font: inherit; padding: .5rem 1rem; }
  #status { margin-top: 1.5rem; font-weight: 600; }
  .note { margin: 0 0 1rem; font-size: .9rem; opacity: .85; }
  small { display: block; margin-top: 2rem; opacity: .75; }
  #report h3 { margin-top: 2rem; }
  #report ul { padding-left: 1.25rem; }
  #report li { margin-bottom: 1.25rem; }
  #report h4 { margin: 0; font-size: 1rem; }
  #report .cite { margin: .1rem 0; font-size: .85rem; opacity: .8; }
  #report p { margin: .25rem 0; }
  #report blockquote { margin: .4rem 0; padding-left: .75rem; border-left: 3px solid currentColor; font-size: .9rem; white-space: pre-wrap; }
  .disclaimer { margin-top: 2rem; padding: .75rem 1rem; border: 1px solid currentColor; border-radius: .5rem; font-size: .9rem; }
  .disclaimer h2 { font-size: 1rem; margin: 0 0 .5rem; }
  .disclaimer p { margin: .4rem 0; }
</style>
</head>
<body>
<main>
  <h1>Itemized</h1>
  <p>Upload a funeral home General Price List to check it against the FTC Funeral Rule.</p>
  <form id="form">
    <label for="file">General Price List (PDF or photo, up to ${maxMb} MB)</label>
    <input id="file" name="file" type="file" accept="${accept}" required>
    <p class="note">Documents are processed by Meta AI models. Upload only price lists you are allowed to share.</p>
    <button type="submit">Check this list</button>
  </form>
  <p id="status" role="status" aria-live="polite"></p>
  <section id="report" aria-labelledby="report-heading" hidden>
    <h2 id="report-heading" tabindex="-1">Findings</h2>
    <div id="report-body"></div>
  </section>
  <section class="disclaimer" aria-labelledby="about-heading">
    <h2 id="about-heading">About these results</h2>
    <p>Itemized is an automated, AI-assisted check of a General Price List against the federal FTC Funeral Rule (16 CFR Part 453). It does not check state law, such as Texas Funeral Service Commission rules. It does not check the Casket Price List, the Outer Burial Container Price List or the Statement of Funeral Goods and Services Selected.</p>
    <p>The AI can misread documents, especially photos. These results are not legal advice and are not a finding that anyone broke the law.</p>
    <p><strong>Funeral homes:</strong> confirm any result with your attorney or your state funeral regulator before acting on it.</p>
    <p><strong>Families:</strong> if something here concerns you, ask the funeral home about it. You can also contact the Federal Trade Commission or the state agency that licenses funeral homes.</p>
  </section>
</main>
<script>
const form = document.getElementById('form');
const statusEl = document.getElementById('status');
const LABELS = {
  queued: 'Waiting in line...',
  extracting: 'Reading the document...',
  checking: 'Checking against the rule...',
  done: 'Done.',
  failed: 'The check failed.',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASIS = ${basisJson};
const GROUPS = [
  ['fail', 'Did not pass'],
  ['review', 'Needs review'],
  ['pass', 'Pass'],
];

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function findingItem(f) {
  const li = el('li');
  li.append(el('h4', f.title + ' (' + f.checkId + ')'));
  li.append(el('p', f.cite || BASIS[f.basis] || '', 'cite'));
  // Some ruleset plain texts describe the problem, so they read wrong under a pass.
  if (f.verdict !== 'pass') li.append(el('p', f.plain));
  if (f.evidence && f.evidence.quote) {
    const q = el('blockquote', f.evidence.quote);
    if (f.evidence.page) q.setAttribute('aria-label', 'Text from page ' + f.evidence.page);
    li.append(q);
  }
  // The engine's reason strings are diagnostic and unreviewed, so the page shows only ruleset text plus this.
  if (f.verdict === 'review') li.append(el('p', 'Itemized could not read or match this part of the list clearly enough to decide. A person should check it.'));
  return li;
}

function renderReport(report) {
  const section = document.getElementById('report');
  const body = document.getElementById('report-body');
  body.replaceChildren();
  const c = report.counts;
  body.append(el('p', c.fail + ' did not pass, ' + c.review + ' need review, ' + c.pass + ' pass. Ruleset ' + report.rulesetId + '@' + report.rulesetVersion + '.'));
  for (const [verdict, label] of GROUPS) {
    const items = report.findings.filter((f) => f.verdict === verdict);
    if (!items.length) continue;
    body.append(el('h3', label + ' (' + items.length + ')'));
    const ul = el('ul');
    for (const f of items) ul.append(findingItem(f));
    body.append(ul);
  }
  const na = report.findings.filter((f) => f.verdict === 'not_applicable');
  if (na.length) {
    const details = el('details');
    details.append(el('summary', 'Not applicable (' + na.length + ')'));
    const ul = el('ul');
    for (const f of na) ul.append(el('li', f.title + ' (' + f.checkId + ')'));
    details.append(ul);
    body.append(details);
  }
  if (report.notRun.length) body.append(el('p', report.notRun.length + ' checks that need model judgment are not run yet.'));
  section.hidden = false;
  document.getElementById('report-heading').focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  document.getElementById('report').hidden = true;
  statusEl.textContent = 'Uploading...';
  try {
    const res = await fetch('/api/audits', { method: 'POST', body: new FormData(form) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Upload failed.');
    for (;;) {
      const audit = await (await fetch('/api/audits/' + body.id)).json();
      statusEl.textContent = LABELS[audit.status] + (audit.error ? ' ' + audit.error : '');
      if (audit.status === 'done' && audit.report) renderReport(audit.report);
      if (audit.status === 'done' || audit.status === 'failed') break;
      await sleep(1500);
    }
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
</script>
</body>
</html>`;
