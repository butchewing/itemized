import { describe, expect, it } from 'vitest';
import type { GplExtraction } from '../src/extraction';
import { citeOf, renderLetterHtml } from '../src/letter';
import { pdfFilename } from '../src/review';
import type { Finding, Report, Verdict } from '../src/rules/types';

const DATE = new Date('2026-10-26T18:00:00Z');

const finding = (checkId: string, verdict: Verdict, over: Partial<Finding> = {}): Finding => ({
  checkId,
  verdict,
  title: `Title ${checkId}`,
  cite: `16 CFR 453.2(b)(4)(${checkId})`,
  basis: 'rule',
  plain: `Plain ${checkId}`,
  evidence: { quote: null, page: null },
  reason: 'test',
  ...over,
});

function report(findings: Finding[]): Report {
  const counts = { fail: 0, review: 0, pass: 0, not_applicable: 0 };
  for (const f of findings) counts[f.verdict]++;
  return { rulesetId: 'ftc-453', rulesetVersion: '2026.1', findings, counts, notRun: [] };
}

const extraction = (providerName: string | null) => ({ providerName }) as GplExtraction;

const HOSTILE = `<script>alert("x")</script> & "Sons"`;

const FINDINGS = [
  finding('a', 'fail', { title: HOSTILE, evidence: { quote: HOSTILE, page: 2 } }),
  finding('b', 'review', { cite: null, basis: 'guide' }),
  finding('c', 'pass'),
  finding('d', 'not_applicable', { cite: 'NA-CITE-SHOULD-STILL-SHOW-IN-NA-LIST' }),
];

describe('renderLetterHtml', () => {
  const html = renderLetterHtml({ extraction: extraction(HOSTILE), modelName: 'Muse Spark 1.3', report: report(FINDINGS), date: DATE });

  it('names the Meta model that read the list', () => {
    expect(html).toContain('Read by Meta’s Muse Spark 1.3.');
  });

  it('escapes model-derived text', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"Sons"');
    expect(html).toContain('Re: the General Price List of &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Sons&quot;');
    expect(html.match(/&lt;script&gt;/g)?.length).toBe(3);
    expect(html).toContain('From your list, page 2');
  });

  it('includes every non-NA finding cite, falling back to the basis text', () => {
    for (const f of FINDINGS.filter((f) => f.verdict !== 'not_applicable')) expect(html).toContain(citeOf(f));
    expect(citeOf(FINDINGS[1]!)).toBe('Interpretation from the FTC compliance guide, not Rule text.');
  });

  it('carries the limits text verbatim as a postscript', () => {
    for (const s of [
      'Itemized is an automated, AI-assisted check of a General Price List against the federal FTC Funeral Rule (16 CFR Part 453). It does not check state law, such as Texas Funeral Service Commission rules. It does not check the Casket Price List, the Outer Burial Container Price List or the Statement of Funeral Goods and Services Selected.',
      'The AI can misread documents, especially photos. These results are not legal advice and are not a finding that anyone broke the law.',
      '<strong>Funeral homes:</strong> confirm any result with your attorney or your state funeral regulator before acting on it.',
      '<strong>Families:</strong> if something here concerns you, ask the funeral home about it. You can also contact the Federal Trade Commission or the state agency that licenses funeral homes.',
      'About these results',
    ]) expect(html).toContain(s);
    expect(html.indexOf('About these results')).toBeGreaterThan(html.indexOf('class="signature"'));
  });

  it('agrees the review count with its verb', () => {
    expect(html).toContain('<strong>1</strong> needs a person’s review');
    const two = renderLetterHtml({
      extraction: null,
      modelName: 'Muse Spark 1.3', report: report([...FINDINGS, finding('e', 'review')]),
      date: DATE,
    });
    expect(two).toContain('<strong>2</strong> need a person’s review');
    expect(two).toContain('Re: your General Price List');
  });

  it('keeps the order and collapses Passed and Not applicable on screen only', () => {
    const order = ['Did not pass', 'Needs a person’s review', 'Passed (1)', 'Not applicable to this list (1)'];
    const at = order.map((s) => html.indexOf(s));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(html).toContain('<details class="group"><summary>Passed (1)');
    const print = renderLetterHtml({ extraction: null, modelName: 'Muse Spark 1.3', report: report(FINDINGS), date: DATE }, 'print');
    expect(print).toContain('<details class="group" open><summary>Passed (1)');
    expect(print).toContain('<details class="group" open><summary>Not applicable to this list (1)');
  });

  it('dates the letter from the review, not the clock', () => {
    expect(html).toContain('October 26, 2026');
    expect(html).toContain('ruleset ftc-453@2026.1, on October 26, 2026.');
  });
});

describe('pdfFilename', () => {
  it('slugs the provider to ascii and falls back to price-list', () => {
    expect(pdfFilename('Bellwether Memorial Chapel', DATE)).toBe('itemized-review-bellwether-memorial-chapel-2026-10-26.pdf');
    expect(pdfFilename('Señor "Ünique" & Sons', DATE)).toBe('itemized-review-senor-unique-sons-2026-10-26.pdf');
    expect(pdfFilename(null, DATE)).toBe('itemized-review-price-list-2026-10-26.pdf');
    expect(pdfFilename('<<>>', DATE)).toBe('itemized-review-price-list-2026-10-26.pdf');
  });
});
