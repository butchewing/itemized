import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ruleset from '../prep/rules/ftc-453@2026.1.json';
import tx from '../prep/rules/tx-651@2026.1.json';
import { parseExtraction, type ExtractedItem, type GplExtraction } from '../src/extraction';
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

describe('TX-005 urns', () => {
  const noUrns = (): GplExtraction => ({ ...base(), items: base().items.filter((i) => !/\burns?\b/i.test(i.label)) });
  it('does not apply without priced urns', () => {
    expect(texasVerdicts(noUrns()).out['TX-005']).toBe('not_applicable');
  });
  it('passes urns that name their material', () => {
    expect(texasVerdicts(withItems(noUrns(), item('Cast bronze urn', 900, '$900'), item('Cherry wood urn', 300, '$300'))).out['TX-005']).toBe('pass');
  });
  it('reviews syn-02, whose "Temporary cremation urn" ($35) names no material', () => {
    expect(texasVerdicts(base()).out['TX-005']).toBe('review');
  });
  it('reviews an urn with no material, and bronze without sheet or cast', () => {
    expect(texasVerdicts(withItems(base(), item('Classic urn', 250, '$250'))).out['TX-005']).toBe('review');
    expect(texasVerdicts(withItems(base(), item('Bronze urn', 900, '$900'))).out['TX-005']).toBe('review');
  });
});
