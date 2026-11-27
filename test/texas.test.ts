import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ruleset from '../prep/rules/ftc-453@2026.1.json';
import tx from '../prep/rules/tx-651@2026.1.json';
import { parseExtraction, type ExtractedItem, type GplExtraction } from '../src/extraction';
import { fixPromptText, renderLetterHtml } from '../src/letter';
import { runChecks } from '../src/rules/engine';
import { isTexas } from '../src/rules/texas';
import type { Verdict } from '../src/rules/types';

const FIXTURES = join(import.meta.dirname, 'fixtures/extractions');
const load = (file: string): GplExtraction => parseExtraction(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')));
const AUDIT_DATE = new Date('2026-10-26T00:00:00Z');

const texasVerdicts = (x: GplExtraction, input: 'pdf' | 'images' = 'pdf') => {
  const r = runChecks(x, ruleset, { auditDate: AUDIT_DATE, input });
  const out: Record<string, Verdict> = {};
  for (const f of r.findings.filter((f) => f.checkId.startsWith('TX-'))) out[f.checkId] = f.verdict;
  return { out, rulesets: r.rulesets };
};

const STATUTE = tx.notices['N-tx-selection'].t;
const CREMATORY = tx.notices['N-tx-crematory'].t;
const THIRD_PARTY = tx.notices['N-tx-third-party-insurance'].t;
const FEDERAL_MIN =
  'The goods and services shown below are those we can provide to our customers. You may choose only the items you desire. If legal or other requirements mean you must buy any items you did not specifically ask for, we will explain the reason in writing on the statement we provide describing the funeral goods and services you selected.';
const BASIC_NO_OVERHEAD = STATUTE.replace('basic services and overhead', 'basic services');

// syn-02 is a Texas list with the full statutory notice; each case changes one thing.
const base = () => load('syn-02.pdf.json');
const withNotices = (x: GplExtraction, ...texts: string[]): GplExtraction => ({
  ...x,
  disclosures: [...x.disclosures.filter((d) => d.id !== 'D-selection'), ...texts.map((t) => ({ id: 'D-selection' as const, text: t, page: 1 }))],
});
const item = (label: string, price: number | null, priceText: string | null, includesText: string | null = null): ExtractedItem => ({
  category: 'other', label, price, priceRange: null, priceText, includesText, page: 1,
});
const withItems = (x: GplExtraction, ...items: ExtractedItem[]): GplExtraction => ({ ...x, items: [...x.items, ...items] });

describe('Texas checks run only for a Texas provider', () => {
  it('recognizes Texas addresses', () => {
    expect(isTexas({ ...base(), address: '72 Quarry Mill Road, Hollis Springs, TX 76999' })).toBe(true);
    expect(isTexas({ ...base(), address: '1 Main St, Austin, Texas' })).toBe(true);
    expect(isTexas({ ...base(), address: '100 Main Street, Yourtown, USA 12345' })).toBe(false);
    expect(isTexas({ ...base(), address: null })).toBe(false);
    // A street number in the Texas ZIP range is not a ZIP code.
    expect(isTexas({ ...base(), address: '75012 Ocean Avenue, Carmel, CA 93921' })).toBe(false);
    expect(isTexas({ ...base(), address: '500 Main St, Lubbock 79401' })).toBe(true);
  });

  it('adds no Texas findings or ruleset for the FTC template', () => {
    const { out, rulesets } = texasVerdicts(load('ftc-sample1-gpl-template.pdf.json'));
    expect(out).toEqual({});
    expect(rulesets).toEqual(['ftc-453@2026.1']);
  });

  it('names both rulesets for a Texas list', () => {
    expect(texasVerdicts(base()).rulesets).toEqual(['ftc-453@2026.1', 'tx-651@2026.1']);
  });
});

describe('TX-002 selection notice: statute vs TFSC rule', () => {
  it('passes the statutory wording', () => {
    expect(texasVerdicts(withNotices(base(), STATUTE)).out['TX-002']).toBe('pass');
  });
  it('flags the federal minimum (no basic-services sentence) for review, never pass', () => {
    expect(texasVerdicts(withNotices(base(), FEDERAL_MIN)).out['TX-002']).toBe('review');
  });
  it('leaves a notice the federal check does not accept to the federal check', () => {
    expect(texasVerdicts(load('syn-11.pdf.json')).out['TX-002']).toBe('not_applicable');
  });
  it('flags "basic services" without "and overhead" for review', () => {
    expect(texasVerdicts(withNotices(base(), BASIC_NO_OVERHEAD)).out['TX-002']).toBe('review');
  });
});

describe('TX-003 crematory notice', () => {
  const crematory = (x: GplExtraction) => ({ ...x, providerName: 'Hollis Springs Funeral Home and Crematory' });
  it('does not apply when the list does not say it runs a crematory', () => {
    expect(texasVerdicts(base()).out['TX-003']).toBe('not_applicable');
  });
  it('the establishment notice alone does not count as the crematory notice', () => {
    expect(texasVerdicts(crematory(withNotices(base(), STATUTE))).out['TX-003']).toBe('review');
  });
  it('passes when both notices are on a combined list', () => {
    expect(texasVerdicts(crematory(withNotices(base(), STATUTE, CREMATORY))).out['TX-003']).toBe('pass');
  });
  it('a third-party crematory fee does not make the provider a crematory', () => {
    const x = withItems(base(), item('Crematory fee (paid to Lone Oak Crematory)', 350, '$350'));
    expect(texasVerdicts(x).out['TX-003']).toBe('not_applicable');
  });
});

describe('TX-001 life insurance claim filing', () => {
  it('does not apply when the list does not offer it', () => {
    expect(texasVerdicts(base()).out['TX-001']).toBe('not_applicable');
  });
  it('passes a priced service, and a no-charge one', () => {
    expect(texasVerdicts(withItems(base(), item('Filing life insurance claim', 75, '$75'))).out['TX-001']).toBe('pass');
    expect(texasVerdicts(withItems(base(), item('Insurance claim processing', null, 'No charge'))).out['TX-001']).toBe('pass');
  });
  it('fails a listed service with a blank price', () => {
    expect(texasVerdicts(withItems(base(), item('Filing life insurance claim', null, '$______'))).out['TX-001']).toBe('fail');
  });
  it('reviews a listed service with no price text at all (it may be free)', () => {
    expect(texasVerdicts(withItems(base(), item('Filing life insurance claim', null, null))).out['TX-001']).toBe('review');
  });
  it('reviews an unreadable price instead of failing', () => {
    expect(texasVerdicts(withItems(base(), item('Filing life insurance claim', null, 'see staff 7'))).out['TX-001']).toBe('review');
  });
  it('on photos, a blank still fails because it is printed on the page', () => {
    expect(texasVerdicts(withItems(base(), item('Filing life insurance claim', null, '$______')), 'images').out['TX-001']).toBe('fail');
  });
});

describe('TX-004 third-party insurance statement', () => {
  const mentionsInsurance = (x: GplExtraction) => withItems(x, item('Funeral package', 5000, '$5,000', 'We accept assignment of life insurance policies.'));
  it('does not apply without any mention of insurance', () => {
    expect(texasVerdicts(base()).out['TX-004']).toBe('not_applicable');
  });
  it('reviews when insurance is mentioned, claim filing is not offered and the statement is missing', () => {
    expect(texasVerdicts(mentionsInsurance(base())).out['TX-004']).toBe('review');
  });
  it('passes with the statement', () => {
    const x = mentionsInsurance(base());
    expect(texasVerdicts({ ...x, disclosures: [...x.disclosures, { id: 'unknown', text: THIRD_PARTY, page: 2 }] }).out['TX-004']).toBe('pass');
  });
  it('does not apply when the home files claims itself', () => {
    expect(texasVerdicts(withItems(mentionsInsurance(base()), item('Filing life insurance claim', 75, '$75'))).out['TX-004']).toBe('not_applicable');
  });
});


describe('the letter for a Texas list', () => {
  const x = withNotices(base(), BASIC_NO_OVERHEAD);
  const report = runChecks(x, ruleset, { auditDate: AUDIT_DATE, input: 'pdf' });
  const html = renderLetterHtml({ extraction: x, report, modelName: 'Meta’s Muse Spark 1.3', date: AUDIT_DATE, uploadedAt: AUDIT_DATE, docSha256: 'abc123def456' });
  it('explains a Texas review as a question of law, not a misread', () => {
    const i = html.indexOf('Selection notice includes');
    const section = html.slice(i, html.indexOf('</li>', i));
    expect(section).toContain('depends on how the law is read');
    expect(section).not.toContain('could not read or match');
  });
  it('names Texas in the fix prompt and the ruleset line', () => {
    expect(fixPromptText(report)).toContain('and the price-list requirements Texas adds');
    expect(html).toContain('and Texas price-list requirements, ruleset tx-651@2026.1');
  });
});

describe('Texas ruleset metadata', () => {
  it('says whether each check rests on the statute or a TFSC rule', () => {
    expect(Object.fromEntries(tx.checks.map((c) => [c.id, c.basis]))).toEqual({
      'TX-001': 'statute', 'TX-002': 'statute', 'TX-003': 'statute', 'TX-004': 'agency_rule',
    });
    for (const c of tx.checks) expect(Object.keys(tx.basis_values)).toContain(c.basis);
  });
  it('points every check at the sections of law it rests on', () => {
    for (const c of tx.checks) {
      expect(c.sections.length, c.id).toBeGreaterThan(0);
      for (const s of c.sections) expect(s, c.id).toMatch(/^us-tx\/(occ|22tac)\/\d+\.\d+$/);
    }
  });
  it('a statute-based check can still fail a list', () => {
    expect(texasVerdicts(withItems(base(), item('Filing life insurance claim', null, '$______'))).out['TX-001']).toBe('fail');
  });
});
