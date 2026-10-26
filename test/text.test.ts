import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ruleset from '../prep/rules/ftc-453@2026.1.json';
import { parseExtraction, type DisclosureId, type GplExtraction } from '../src/extraction';
import { runChecks } from '../src/rules/engine';
import { buildCorpus, matchCompleteList, matchDisclosure, normalize } from '../src/rules/text';

const SELECTION =
  'The goods and services shown below are those we can provide to our customers. You may choose only the items you desire. However, any funeral arrangements you select will include a charge for our basic services and overhead. If legal or other requirements mean you must buy any items you did not specifically ask for, we will explain the reason in writing on the statement we provide describing the funeral goods and services you selected.';
const EMBALMING =
  'Embalming is not required by law. Embalming may be necessary, however, if you select certain funeral arrangements, such as a funeral with viewing. If you do not want embalming, you usually have the right to choose an arrangement that does not require you to pay for it, such as direct cremation or immediate burial.';
const ALT =
  'If you want to arrange a direct cremation, you can use an alternative container. Alternative containers encase the body and can be made of materials like fiberboard or composition materials (with or without an outside covering). The containers we provide are ';
const PARAPHRASE = "You only pay for what you pick. Some items may be needed because of laws or cemetery rules, and we'll let you know.";

const doc = (texts: string[], id: DisclosureId | 'unknown' = 'unknown'): GplExtraction => ({
  caption: 'General Price List',
  providerName: 'Test',
  address: '1 Main',
  phone: '555-0100',
  effectiveDate: { raw: 'September 1, 2026', iso: '2026-09-01' },
  disclosures: texts.map((text) => ({ id, text, page: 1 })),
  items: [{ category: 'embalming', label: 'Embalming', price: 795, priceRange: null, priceText: '$795', includesText: null, page: 1 }],
});
const match = (texts: string[], id: DisclosureId, tag: DisclosureId | 'unknown' = 'unknown') =>
  matchDisclosure(buildCorpus(doc(texts, tag)), ruleset, id);
const verdict = (x: GplExtraction, checkId: string) =>
  runChecks(x, ruleset, { auditDate: new Date('2026-10-26T00:00:00Z') }).findings.find((f) => f.checkId === checkId)!.verdict;

describe('normalize', () => {
  it('straightens quotes, keeps $, drops other punctuation', () => {
    expect(normalize('We’ll  charge $1,595.')).toBe('we ll charge $1 595');
  });
});

describe('disclosure matching', () => {
  it('matches the Rule text exactly', () => {
    const m = match([SELECTION], 'D-selection');
    expect(m.status).toBe('present');
    expect(m.conditional.basic_services_declared_nondeclinable).toBe('present');
    expect(m.optional['and overhead']).toBe(true);
  });

  it('accepts the lawful variant without "and overhead"', () => {
    const m = match([SELECTION.replace(' and overhead', '')], 'D-selection');
    expect(m.status).toBe('present');
    expect(m.optional['and overhead']).toBe(false);
    const n = match(['This fee for our basic services will be added to the total cost of the funeral arrangements you select. (This fee is already included in our charges for direct cremations, immediate burials, and forwarding or receiving remains.)'], 'D-basic-nondeclinable');
    expect(n.status).toBe('present');
  });

  it('accepts the selection statement without its conditional sentence', () => {
    const m = match([SELECTION.replace(' However, any funeral arrangements you select will include a charge for our basic services and overhead.', '')], 'D-selection');
    expect(m.status).toBe('present');
    expect(m.conditional.basic_services_declared_nondeclinable).toBe('absent');
  });

  it('passes embalming without "Except in certain special cases" and sends C-033 to review', () => {
    const m = match([EMBALMING], 'D-embalming');
    expect(m.status).toBe('present');
    expect(m.optional['Except in certain special cases,']).toBe(false);
    const x = doc([EMBALMING]);
    expect(verdict(x, 'C-030')).toBe('pass');
    expect(verdict(x, 'C-033')).toBe('review');
  });

  it('tolerates bracket typography in the FTC template', () => {
    const m = match([`[Except in certain special cases]* [E]${EMBALMING.slice(1)}`], 'D-embalming');
    expect(m.status).toBe('present');
    expect(m.optional['Except in certain special cases,']).toBe(true);
  });

  it('passes small wording drift', () => {
    expect(match(['This fee is for our basic services and overhead will be added to the total cost of the funeral arrangements you select. (This fee is already included in our charges for direct cremations, immediate burials, and forwarding or receiving remains.)'], 'D-basic-nondeclinable').status).toBe('present');
    expect(match([SELECTION.replace('we provide describing', 'we provide you describing')], 'D-selection').status).toBe('present');
  });

  it('does not match the syn-11 paraphrase by text, and only a model tag lifts it to altered', () => {
    const plain = match([PARAPHRASE], 'D-selection');
    expect(plain.status).toBe('absent');
    expect(Math.max(...plain.segmentScores)).toBeLessThan(ruleset.text_matching.thresholds.altered);
    expect(match([PARAPHRASE], 'D-selection', 'D-selection').status).toBe('altered');
    const syn11 = parseExtraction(JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/extractions/syn-11.pdf.json'), 'utf8')));
    expect(verdict(syn11, 'C-010')).toBe('review');
  });

  it('never lets a model tag alone make a disclosure present', () => {
    expect(match(['Some unrelated note about parking.'], 'D-embalming', 'D-embalming').status).toBe('altered');
  });

  it('reads a filled containers slot and flags a template marker', () => {
    expect(match([`${ALT}a fiberboard container or an unfinished wood box.`], 'D-alt-container').slots.containers).toEqual({
      text: 'a fiberboard container or an unfinished wood box',
      state: 'filled',
    });
    const marker = match([`${ALT}(specify containers).`], 'D-alt-container');
    expect(marker.status).toBe('present');
    expect(marker.slots.containers!.state).toBe('marker');
  });
});

describe('complete price list sentence', () => {
  const count = (texts: string[]) => matchCompleteList(buildCorpus(doc(texts)), ruleset);
  it('counts each occurrence', () => {
    const s = 'A complete price list will be provided at the funeral home.';
    expect(count([s, s])).toMatchObject({ present: 2, altered: 0 });
  });
  it('puts the truncated sentence in the altered band', () => {
    expect(count(['A complete price list will be provided.'])).toMatchObject({ present: 0, altered: 1 });
  });
});
