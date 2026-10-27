import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ruleset from '../prep/rules/ftc-453@2026.1.json';
import { mergeExtractions, pageBatches, parseExtraction, SYSTEM_PROMPT, type ExtractedItem, type GplExtraction } from '../src/extraction';
import { runChecks } from '../src/rules/engine';
import { buildCorpus, matchCompleteList, matchDisclosure } from '../src/rules/text';
import type { Verdict } from '../src/rules/types';

// Synthetic look-alikes of patterns first seen on the private real corpus (open weights). Each
// fixture in test/fixtures/patterns is syn-01 with one pattern written in; no real list text.
const AUDIT_DATE = new Date('2026-10-26T00:00:00Z');
const load = (name: string): GplExtraction =>
  parseExtraction(JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/patterns', `${name}.json`), 'utf8')));
const RANK: Record<Verdict, number> = { fail: 3, review: 2, pass: 1, not_applicable: 0 };
function verdicts(x: GplExtraction, input: 'pdf' | 'images' = 'pdf'): Record<string, Verdict> {
  const out: Record<string, Verdict> = {};
  for (const f of runChecks(x, ruleset, { auditDate: AUDIT_DATE, semantic: null, input }).findings) {
    if (!out[f.checkId] || RANK[f.verdict] > RANK[out[f.checkId]!]) out[f.checkId] = f.verdict;
  }
  return out;
}
const relabel = (x: GplExtraction, pick: (i: ExtractedItem) => boolean, patch: Partial<ExtractedItem>): GplExtraction => ({
  ...x,
  items: x.items.map((i) => (pick(i) ? { ...i, ...patch } : i)),
});
const is = (category: string, label?: RegExp) => (i: ExtractedItem) => i.category === category && (!label || label.test(i.label));

describe('a description folded into the item label (fix 1)', () => {
  const x = load('label-description');

  it('counts the label tail as the description', () => {
    const v = verdicts(x);
    expect(v['C-020']).toBe('pass');
    expect(v['C-060']).toBe('pass');
    expect(v['C-061']).toBe('pass');
    expect(v['C-052']).toBe('pass');
  });

  it('still reads a header whose label carries its description as the header', () => {
    const v = verdicts(x);
    expect(v['C-050']).toBe('pass');
    expect(v['C-053']).toBe('pass');
  });

  it('does not count a short tail or a required disclosure inside the label', () => {
    expect(verdicts(relabel(x, is('basic_services'), { label: 'Basic Services of Funeral Director and Staff: see reverse side' }))['C-020']).toBe('fail');
    const statement =
      'This fee for our basic services will be added to the total cost of the funeral arrangements you select. (This fee is already included in our charges for direct cremations, immediate burials, and forwarding or receiving remains.)';
    expect(verdicts(relabel(x, is('basic_services'), { label: `Basic Services of Funeral Director and Staff: ${statement}` }))['C-020']).toBe('fail');
  });

  it('reads a lone priced direct cremation line with a folded description as the header, not an option', () => {
    const lone = {
      ...x,
      items: [
        ...x.items.filter((i) => i.category !== 'direct_cremation'),
        { category: 'direct_cremation' as const, label: 'Direct Cremation: includes transfer of remains, an alternative container, and the crematory fee', price: 1500, priceRange: null, priceText: '$1,500', includesText: null, page: 2 },
      ],
    };
    const v = verdicts(lone);
    expect(v['C-041']).toBe('review');
    expect(v['C-042']).toBe('pass');
  });

  it('does not read an option label after a colon as a description', () => {
    const opts = relabel(x, is('immediate_burial', /^A\./), { label: 'A. Immediate burial: with casket provided by the purchaser' });
    const header = relabel(opts, is('immediate_burial', /^Immediate Burial:/), { label: 'Immediate Burial' });
    const v = verdicts(header);
    expect(v['C-052']).toBe('fail');
    expect(v['C-050']).toBe('pass');
  });
});

describe('an unpriced sub-option under a priced parent line (fix 2)', () => {
  const x = load('suboption');
  const cardboard = is('direct_cremation', /^1\. Cardboard/);

  it('counts a numbered sub-option directly under a priced line as offered at that price', () => {
    const v = verdicts(x);
    expect(v['C-041']).toBe('pass');
    expect(v['C-050']).toBe('pass');
    expect(verdicts(x, 'images')['C-041']).toBe('pass');
  });

  it('does not invent a purchaser option', () => {
    expect(verdicts(x)['C-040']).toBe('fail');
  });

  it('reviews rather than passes or fails when the structure is ambiguous', () => {
    const at = x.items.findIndex(cardboard);
    const two = { ...x, items: [...x.items.slice(0, at + 1), { ...x.items[at]!, label: '2. Fiberboard container' }, ...x.items.slice(at + 1)] };
    expect(verdicts(two)['C-041']).toBe('review');
    expect(verdicts(relabel(x, cardboard, { page: 3 }))['C-041']).toBe('review');
    expect(verdicts(relabel(x, cardboard, { label: 'Cardboard Box' }))['C-041']).toBe('review');
  });

  it('still fails a sub-option under a price range or with a printed blank', () => {
    const ranged = relabel(x, is('direct_cremation', /^DIRECT/), { price: null, priceRange: [1395, 1995], priceText: '$1,395 to $1,995' });
    expect(verdicts(ranged)['C-041']).toBe('fail');
    expect(verdicts(relabel(x, cardboard, { priceText: '$______' }))['C-041']).toBe('fail');
  });
});

describe('a close paraphrase of a required statement (fix 3)', () => {
  const x = load('paraphrase');
  const EMBALMING_PARAPHRASE =
    'Embalming is not required by law. It may be needed if you choose a funeral with viewing, and you can choose an arrangement that does not include it.';
  const withDisclosure = (id: 'D-embalming' | 'unknown', text: string, drop: (t: string) => boolean): GplExtraction => ({
    ...x,
    disclosures: [...x.disclosures.filter((d) => !drop(d.text)), { id, text, page: 1 }],
  });

  it('reviews the complete-list paraphrase on PDFs and photos', () => {
    expect(matchCompleteList(buildCorpus(x), ruleset)).toMatchObject({ present: 0, altered: 0, paraphrase: 1 });
    for (const input of ['pdf', 'images'] as const) {
      const v = verdicts(x, input);
      expect(v['C-072'], input).toBe('review');
      expect(v['C-073'], input).toBe('review');
    }
  });

  it('keeps failing a rewrite that drops the "not required by law" content', () => {
    expect(matchDisclosure(buildCorpus(x), ruleset, 'D-embalming').status).toBe('absent');
    expect(verdicts(x)['C-030']).toBe('fail');
  });

  it('reviews an embalming paraphrase that keeps its key content', () => {
    const p = withDisclosure('unknown', EMBALMING_PARAPHRASE, () => false);
    const m = matchDisclosure(buildCorpus(p), ruleset, 'D-embalming');
    expect(m).toMatchObject({ status: 'altered', band: 'paraphrase' });
    expect(verdicts(p)['C-030']).toBe('review');
  });

  it('does not let "alternative container" in an item description stand in for the disclosure', () => {
    expect(matchDisclosure(buildCorpus(x), ruleset, 'D-alt-container').status).toBe('absent');
    expect(verdicts(x)['C-044']).toBe('fail');
  });

  it('still fails when the statement is absent or lacks its key terms', () => {
    const gone = withDisclosure('unknown', 'Ask us about casket prices at the funeral home.', (t) => t.startsWith('A complete list'));
    expect(verdicts(gone)['C-072']).toBe('fail');
    expect(verdicts(gone)['C-073']).toBe('fail');
  });
});

describe('page batches for providers with an image cap (fix 5)', () => {
  it('splits into balanced batches of at most the cap', () => {
    expect(pageBatches(10, 8)).toEqual([5, 5]);
    expect(pageBatches(8, 8)).toEqual([8]);
    expect(pageBatches(9, 4)).toEqual([3, 3, 3]);
    expect(pageBatches(10, 50)).toEqual([10]);
  });

  const part = (over: Partial<GplExtraction>): GplExtraction => ({
    caption: null, providerName: null, address: null, phone: null, effectiveDate: null, disclosures: [], items: [], ...over,
  });
  const it1 = (label: string, page: number): ExtractedItem => ({
    category: 'other', label, price: 1, priceRange: null, priceText: '$1', includesText: null, page,
  });

  it('merges batches in page order with original page numbers', () => {
    const merged = mergeExtractions([
      { firstPage: 1, x: part({ caption: 'General Price List', phone: null, items: [it1('a', 1), it1('b', 2)], disclosures: [{ id: 'unknown', text: 'n1', page: 2 }] }) },
      { firstPage: 3, x: part({ caption: 'Ignored', phone: '(512) 555-0100', items: [it1('c', 1), it1('d', 2)], disclosures: [{ id: 'unknown', text: 'n2', page: 1 }] }) },
    ]);
    expect(merged.caption).toBe('General Price List');
    expect(merged.phone).toBe('(512) 555-0100');
    expect(merged.items.map((i) => [i.label, i.page])).toEqual([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
    expect(merged.disclosures.map((d) => [d.text, d.page])).toEqual([['n1', 2], ['n2', 3]]);
  });

  it('returns a single batch unchanged', () => {
    const x = load('suboption');
    expect(mergeExtractions([{ firstPage: 1, x }])).toEqual(x);
  });
});

describe('extraction prompt (fix 4)', () => {
  it('tells the model the provider name, address and phone may sit in a logo or letterhead', () => {
    expect(SYSTEM_PROMPT).toMatch(/logo, letterhead, header or footer/);
  });
});
