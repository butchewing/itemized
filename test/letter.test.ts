import { describe, expect, it } from 'vitest';
import type { GplExtraction } from '../src/extraction';
import ruleset from '../prep/rules/ftc-453@2026.1.json';
import { citeOf, fixPromptText, renderLetterHtml, requiredWording, summarySentence } from '../src/letter';
import { pdfFilename } from '../src/review';
import type { Finding, Report, Verdict } from '../src/rules/types';

const DATE = new Date('2026-10-26T18:00:00Z');
const UPLOADED = new Date('2026-10-24T23:30:00Z');
const SHA = 'A3F09C21B7E4D5C6F8091A2B3C4D5E6F708192A3B4C5D6E7F8091A2B3C4D5E6F';
const PROVENANCE = { uploadedAt: UPLOADED, docSha256: SHA };

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
  const html = renderLetterHtml({ extraction: extraction(HOSTILE), modelName: 'Muse Spark 1.3', report: report(FINDINGS), date: DATE, ...PROVENANCE });

  it('names the Meta model that read the list', () => {
    expect(html).toContain('Read by Meta’s Muse Spark 1.3.');
  });

  it('escapes model-derived text', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"Sons"');
    expect(html).toContain('Re: the General Price List of &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Sons&quot;');
    // Re line, finding title and quote, then the same title and quote again in the fix prompt.
    expect(html.match(/&lt;script&gt;/g)?.length).toBe(5);
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
      ...PROVENANCE,
    });
    expect(two).toContain('<strong>2</strong> need a person’s review');
    expect(two).toContain('Re: your General Price List');
  });

  it('leaves zero counts out of the summary', () => {
    expect(summarySentence(0, 0, 40)).toBe('All <strong>40</strong> checks Itemized could run on this list passed.');
    expect(summarySentence(3, 0, 24)).toBe('Of the 27 checks Itemized could run on this list, <strong>3</strong> did not pass and <strong>24</strong> passed.');
    expect(summarySentence(0, 6, 35)).toBe('Of the 41 checks Itemized could run on this list, <strong>6</strong> need a person’s review and <strong>35</strong> passed.');
    expect(summarySentence(1, 1, 1)).toBe('Of the 3 checks Itemized could run on this list, <strong>1</strong> did not pass, <strong>1</strong> needs a person’s review, and <strong>1</strong> passed.');
    expect(summarySentence(2, 0, 0)).toBe('Of the 2 checks Itemized could run on this list, <strong>2</strong> did not pass.');
    expect(summarySentence(0, 0, 0)).toBe('Itemized could not run any checks on this list.');
  });

  it('keeps the order and collapses Passed and Not applicable on screen only', () => {
    const order = ['Did not pass', 'Needs a person’s review', 'Passed (1)', 'Not applicable to this list (1)'];
    const at = order.map((s) => html.indexOf(s));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    expect(html).toContain('<details class="group"><summary>Passed (1)');
    const print = renderLetterHtml({ extraction: null, modelName: 'Muse Spark 1.3', report: report(FINDINGS), date: DATE, ...PROVENANCE }, 'print');
    expect(print).toContain('<details class="group" open><summary>Passed (1)');
    expect(print).toContain('<details class="group" open><summary>Not applicable to this list (1)');
  });

  it('dates the letter from the review, not the clock', () => {
    expect(html).toContain('October 26, 2026');
    expect(html).toContain('ruleset ftc-453@2026.1, on October 26, 2026.');
  });
});

describe('review notes', () => {
  const DETERMINISTIC_NOTE = 'Itemized could not read or match this part of the list clearly enough to decide. A person should check it.';
  const JUDGMENT_NOTE = 'This item calls for judgment about wording or placement. A person should read the quoted text and decide.';
  const html = renderLetterHtml({
    extraction: null,
    modelName: 'Muse Spark 1.3',
    report: report([finding('C-081', 'review', { title: 'Semantic one' }), finding('C-010', 'review', { title: 'Deterministic one' })]),
    date: DATE,
    ...PROVENANCE,
  });
  const itemOf = (title: string) => html.slice(html.indexOf(title), html.indexOf('</li>', html.indexOf(title)));

  it('gives a semantic check’s review the judgment note', () => {
    expect(itemOf('Semantic one')).toContain(JUDGMENT_NOTE);
    expect(itemOf('Semantic one')).not.toContain(DETERMINISTIC_NOTE);
  });

  it('keeps the read-or-match note on a deterministic check’s review', () => {
    expect(itemOf('Deterministic one')).toContain(DETERMINISTIC_NOTE);
    expect(itemOf('Deterministic one')).not.toContain(JUDGMENT_NOTE);
  });
});

describe('provenance', () => {
  const html = renderLetterHtml({ extraction: extraction(HOSTILE), modelName: 'Muse Spark 1.3', report: report(FINDINGS), date: DATE, ...PROVENANCE });

  it('states the first upload date and a 12-hex lowercase fingerprint after the model line', () => {
    expect(html).toContain(
      'This review covers the document first uploaded to Itemized on October 24, 2026 (file fingerprint a3f09c21b7e4). Itemized does not verify who published the document.',
    );
    expect(html).toMatch(/\(file fingerprint [0-9a-f]{12}\)\./);
    expect(html.indexOf('This review covers')).toBeGreaterThan(html.indexOf('Read by Meta’s'));
    expect(html.indexOf('This review covers')).toBeLessThan(html.indexOf('About these results'));
  });

  it('carries the same sentence into the print version that becomes the PDF', () => {
    const print = renderLetterHtml({ extraction: null, modelName: 'Muse Spark 1.3', report: report(FINDINGS), date: DATE, ...PROVENANCE }, 'print');
    expect(print).toContain('(file fingerprint a3f09c21b7e4)');
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

describe('fix prompt', () => {
  const FIXED = [
    "I run a funeral home. Below is a review of our General Price List against the Federal Trade Commission's Funeral Rule (16 CFR Part 453), made by Itemized. Please help me draft a revised General Price List.",
    'Rules for your draft:',
    '- Keep every price exactly as it is. Do not invent, change or remove prices. If a required item needs a price we have not given, write [PRICE NEEDED] and leave it for me.',
    '- Where a required statement is missing or worded differently, add the exact required wording given below. Do not paraphrase it.',
    '- For items marked "Needs a person\'s review", do not change anything. List them at the end as questions for me.',
    '- Do not add services, packages or claims that are not already on our list.',
    '- At the end, list every change you made and every question for me.',
    '- Remind me to have the final list checked by our attorney or our state funeral regulator before we use it.',
    'Itemized findings:',
    'Our current General Price List is attached.',
  ];
  const missingEmbalming = finding('C-030', 'fail', {
    title: 'Embalming disclosure present',
    cite: '16 CFR 453.3(a)(2)(ii)',
    plain: 'Next to the embalming price, the list must say that embalming usually isn’t required by law.',
    evidence: { quote: null, page: null, disclosureId: 'D-embalming' },
  });
  const hostileReview = finding('C-081', 'review', { title: HOSTILE, evidence: { quote: HOSTILE, page: 2 } });
  const text = fixPromptText(report([missingEmbalming, hostileReview, finding('c', 'pass')]))!;

  it('carries the fixed template sentences verbatim', () => {
    for (const s of FIXED) expect(text).toContain(s);
    expect(text.startsWith(FIXED[0]!)).toBe(true);
    expect(text.endsWith(FIXED.at(-1)!)).toBe(true);
  });

  it('gives a missing disclosure the ruleset wording, segment for segment', () => {
    const fromRuleset = ruleset.disclosures['D-embalming'].segments.map((s) => s.t).join(' ');
    expect(requiredWording('D-embalming')).toBe(fromRuleset);
    expect(text).toContain(
      `- Did not pass: Embalming disclosure present (16 CFR 453.3(a)(2)(ii)). Next to the embalming price, the list must say that embalming usually isn’t required by law.\n  Required wording: "${fromRuleset}"`,
    );
  });

  it('marks optional, conditional and slot segments without inventing wording', () => {
    expect(requiredWording('D-selection')).toBe(
      'The goods and services shown below are those we can provide to our customers. You may choose only the items you desire. [only when your basic services fee cannot be declined: However, any funeral arrangements you select will include a charge for our basic services [optional: and overhead].] If legal or other requirements mean you must buy any items you did not specifically ask for, we will explain the reason in writing on the statement we provide describing the funeral goods and services you selected.',
    );
    expect(requiredWording('D-alt-container')).toMatch(/The containers we provide are \[containers\]\.$/);
  });

  it('labels review items and quotes the list with its page', () => {
    expect(text).toContain(`- Needs a person's review: ${HOSTILE} (16 CFR 453.2(b)(4)(C-081)). Plain C-081\n  From our list, page 2: "${HOSTILE}"`);
    expect(text.indexOf('- Did not pass')).toBeLessThan(text.indexOf("- Needs a person's review"));
  });

  it('is plain text with no HTML entities', () => {
    expect(text).not.toMatch(/&(amp|lt|gt|quot|#39);/);
  });

  it('is absent when every check passed', () => {
    const all = report([finding('c', 'pass'), finding('d', 'not_applicable')]);
    expect(fixPromptText(all)).toBeNull();
    expect(renderLetterHtml({ extraction: null, modelName: 'M', report: all, date: DATE, ...PROVENANCE })).not.toContain('fix-prompt');
  });

  it('renders escaped on screen, after the findings and before the signature, and not in print', () => {
    const input = { extraction: extraction('Bellwether Memorial Chapel'), modelName: 'M', report: report([missingEmbalming, hostileReview]), date: DATE, ...PROVENANCE };
    const html = renderLetterHtml(input);
    const section = html.slice(html.indexOf('<section class="group fix-prompt"'), html.indexOf('</section>', html.indexOf('fix-prompt')));
    expect(section).toContain('Fix it with your AI assistant');
    expect(section).toContain('Copy this prompt into an AI assistant such as ChatGPT or Claude, and attach your price list.');
    expect(section).not.toContain('<script>');
    expect(section).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Sons&quot;');
    expect(section).toContain('data-filename="itemized-fix-prompt-bellwether-memorial-chapel-2026-10-26.txt"');
    expect(html.indexOf('fix-prompt')).toBeGreaterThan(html.indexOf('Needs a person’s review'));
    expect(html.indexOf('fix-prompt')).toBeLessThan(html.indexOf('class="signature"'));
    expect(renderLetterHtml(input, 'print')).not.toContain('fix-prompt');
  });
});

describe('required wording punctuation', () => {
  it('ends every rebuilt statement with a period, including after a blank or a conditional sentence', () => {
    expect(requiredWording('D-alt-container').endsWith('The containers we provide are [containers].')).toBe(true);
    const selection = requiredWording('D-selection');
    expect(selection).toMatch(/charge for our basic services \[optional: and overhead\]\.\] If legal or other requirements/);
    for (const id of ['D-selection', 'D-basic-nondeclinable', 'D-basic-in-casket', 'D-embalming', 'D-alt-container', 'D-casket-list', 'D-obc-list', 'D-obc-legal'] as const) {
      expect(requiredWording(id), id).toMatch(/[.?!]$/);
    }
  });
});
