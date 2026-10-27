import ruleset from '../prep/rules/ftc-453@2026.1.json';
import type { GplExtraction } from './extraction';
import type { Finding, Report, Verdict } from './rules/types';

export type LetterInput = {
  extraction: GplExtraction | null;
  report: Report;
  modelName: string;
  // When the review finished; the letter, its closing line and the PDF filename all use it.
  date: Date;
  // When this file was first uploaded; a repeat upload reuses the audit, so this stays fixed.
  uploadedAt: Date;
  docSha256: string;
};

export type LetterMode = 'screen' | 'print';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);

// Compliance-reviewed wording. Shown on the page before any upload and as the letter's postscript.
export const LIMITS_PARAGRAPHS = `<p>Itemized is an automated, AI-assisted check of a General Price List against the federal FTC Funeral Rule (16 CFR Part 453). It does not check state law, such as Texas Funeral Service Commission rules. It does not check the Casket Price List, the Outer Burial Container Price List or the Statement of Funeral Goods and Services Selected.</p>
      <p>The AI can misread documents, especially photos. These results are not legal advice and are not a finding that anyone broke the law.</p>
      <p><strong>Funeral homes:</strong> confirm any result with your attorney or your state funeral regulator before acting on it.</p>
      <p><strong>Families:</strong> if something here concerns you, ask the funeral home about it. You can also contact the Federal Trade Commission or the state agency that licenses funeral homes.</p>`;

const REVIEW_NOTES = {
  deterministic: 'Itemized could not read or match this part of the list clearly enough to decide. A person should check it.',
  semantic: 'This item calls for judgment about wording or placement. A person should read the quoted text and decide.',
} as const;

// Keyed on the ruleset's engine, not the stored finding, so reports saved before this note existed get it too.
const ENGINE_OF = new Map(ruleset.checks.map((c) => [c.id, c.engine]));
const reviewNote = (f: Finding) => REVIEW_NOTES[ENGINE_OF.get(f.checkId) === 'semantic' ? 'semantic' : 'deterministic'];

const BASIS: Record<string, string> = ruleset.basis_values;

const DETAILED: [Verdict, string][] = [
  ['fail', 'Did not pass'],
  ['review', 'Needs a person’s review'],
];
const LISTED: [Verdict, string][] = [
  ['pass', 'Passed'],
  ['not_applicable', 'Not applicable to this list'],
];

export const letterDate = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const citeOf = (f: Finding) => f.cite || BASIS[f.basis] || '';

function findingItem(f: Finding): string {
  const quote = f.evidence.quote
    ? `<blockquote>${escapeHtml(f.evidence.quote)}<span class="from">${
        f.evidence.page ? `From your list, page ${escapeHtml(f.evidence.page)}` : 'From your list'
      }</span></blockquote>`
    : '';
  const note = f.verdict === 'review' ? `<p class="review-note">${reviewNote(f)}</p>` : '';
  return `<li class="finding"><h4>${escapeHtml(f.title)}</h4><p class="plain">${escapeHtml(f.plain)}</p>${quote}${note}<div class="margin">${escapeHtml(citeOf(f))}</div></li>`;
}

const simpleItem = (f: Finding) =>
  `<li><span>${escapeHtml(f.title)}</span><span class="cite">${escapeHtml(citeOf(f))}</span></li>`;

// Zero counts are left out: "0 did not pass, 0 need review, and 40 passed" read as a contradiction.
export function summarySentence(fail: number, review: number, pass: number): string {
  const ran = fail + review + pass;
  if (ran === 0) return 'Itemized could not run any checks on this list.';
  if (fail === 0 && review === 0) return `All <strong>${pass}</strong> checks Itemized could run on this list passed.`;
  const parts = [
    fail ? `<strong>${fail}</strong> did not pass` : '',
    review ? `<strong>${review}</strong> ${review === 1 ? 'needs' : 'need'} a person’s review` : '',
    pass ? `<strong>${pass}</strong> passed` : '',
  ].filter(Boolean);
  const joined = parts.length === 1 ? parts[0] : parts.length === 2 ? `${parts[0]} and ${parts[1]}` : `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
  return `Of the ${ran} checks Itemized could run on this list, ${joined}.`;
}

export function renderLetterHtml({ extraction, report, modelName, date, uploadedAt, docSha256 }: LetterInput, mode: LetterMode = 'screen'): string {
  const provider = extraction?.providerName;
  const when = letterDate(date);
  const c = report.counts;
  const byVerdict = (v: Verdict) => report.findings.filter((f) => f.verdict === v);

  const detailed = DETAILED.map(([verdict, label]) => {
    const items = byVerdict(verdict);
    if (!items.length) return '';
    return `<section class="group ${verdict}"><h3>${label}<span class="count">${items.length}</span></h3><ul class="findings">${items.map(findingItem).join('')}</ul></section>`;
  }).join('');

  // A closed <details> prints collapsed, so the PDF renders these groups open.
  const listed = LISTED.map(([verdict, label]) => {
    const items = byVerdict(verdict);
    if (!items.length) return '';
    return `<details class="group"${mode === 'print' ? ' open' : ''}><summary>${label} (${items.length})</summary><ul class="simple">${items.map(simpleItem).join('')}</ul></details>`;
  }).join('');

  const notRun = report.notRun.length
    ? `<p>${report.notRun.length} further checks that need judgment about wording and placement are not part of this review yet.</p>`
    : '';

  return `<p class="letter-date">${escapeHtml(when)}</p>
    <h2 class="letter-re" id="letter-re" tabindex="-1">Re: ${provider ? `the General Price List of ${escapeHtml(provider)}` : 'your General Price List'}</h2>
    <p class="summary">${summarySentence(c.fail, c.review, c.pass)}</p>
    ${detailed}${listed}
    <div class="closing">
      <p class="signature">Itemized</p>
      <p>Read by Meta’s ${escapeHtml(modelName)}. Checked against the FTC Funeral Rule, ruleset ${escapeHtml(report.rulesetId)}@${escapeHtml(report.rulesetVersion)}, on ${escapeHtml(when)}.</p>
      <p>This review covers the document first uploaded to Itemized on ${escapeHtml(letterDate(uploadedAt))} (file fingerprint ${escapeHtml(docSha256.slice(0, 12).toLowerCase())}). Itemized does not verify who published the document.</p>
      ${notRun}
    </div>
    <section class="limits" aria-labelledby="letter-limits">
      <h3 id="letter-limits">About these results</h3>
      ${LIMITS_PARAGRAPHS}
    </section>`;
}
