import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ruleset from '../prep/rules/ftc-453@2026.1.json';
import synLabels from '../prep/synthetic/labels.json';
import ftcLabels from '../specimens/labels.json';
import { parseExtraction, type GplExtraction } from '../src/extraction';
import { CHECKS, DETERMINISTIC_CHECK_IDS } from '../src/rules/checks';
import { runChecks } from '../src/rules/engine';
import type { Report, Verdict } from '../src/rules/types';

const FIXTURES = join(import.meta.dirname, 'fixtures/extractions');
const AUDIT_DATE = new Date('2026-10-26T00:00:00Z');
const DETERMINISTIC = ruleset.checks.filter((c) => c.engine === 'deterministic').map((c) => c.id);
const SYN_LISTS = synLabels.documents.map((d) => d.id);
const PHOTO_LISTS = ['syn-01', 'syn-03', 'syn-09', 'syn-10'];

const load = (file: string): GplExtraction => parseExtraction(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')));
const run = (x: GplExtraction) => runChecks(x, ruleset, { auditDate: AUDIT_DATE });

// Photos are one page each; the manifest says to audit both pages of a list together.
function mergePhotos(list: string, dir = ''): GplExtraction {
  const [p1, p2] = [1, 2].map((n) => load(join(dir, `${list}-${n}.jpeg.json`))) as [GplExtraction, GplExtraction];
  return {
    caption: p1.caption ?? p2.caption,
    providerName: p1.providerName ?? p2.providerName,
    address: p1.address ?? p2.address,
    phone: p1.phone ?? p2.phone,
    effectiveDate: p1.effectiveDate ?? p2.effectiveDate,
    disclosures: [...p1.disclosures, ...p2.disclosures.map((d) => ({ ...d, page: 2 }))],
    items: [...p1.items, ...p2.items.map((i) => ({ ...i, page: 2 }))],
  };
}

const RANK: Record<Verdict, number> = { fail: 3, review: 2, pass: 1, not_applicable: 0 };
function byCheck(r: Report): Record<string, Verdict> {
  const out: Record<string, Verdict> = {};
  for (const f of r.findings) if (!out[f.checkId] || RANK[f.verdict] > RANK[out[f.checkId]!]) out[f.checkId] = f.verdict;
  return out;
}

type Expectation = { expected: string; also_ok?: string[] };
const fails = (r: Report) => [...new Set(r.findings.filter((f) => f.verdict === 'fail').map((f) => f.checkId))].sort();

// Mismatches against labels.json that are deliberate. Each must stay a review, never a fail
// where the label says pass, and each is reported in the Day 3 notes.
const KNOWN_DEVIATIONS: { list: string; check: string; got: Verdict; reason: string }[] = [
  {
    list: 'syn-07',
    check: 'C-061',
    got: 'review',
    reason: 'Receiving is the last item on page 1 and the extractor dropped its "includes" paragraph (Day 2); a page-split paragraph is review, not fail.',
  },
];

describe('registry', () => {
  it('implements every deterministic ruleset check and nothing else', () => {
    expect([...DETERMINISTIC_CHECK_IDS].sort()).toEqual([...DETERMINISTIC].sort());
    expect(Object.keys(CHECKS).sort()).toEqual([...DETERMINISTIC].sort());
  });
});

describe('synthetic PDFs against labels.json', () => {
  const rows: Record<string, string>[] = [];
  const mismatches: { list: string; check: string; got: Verdict; expected: string }[] = [];
  for (const doc of synLabels.documents) {
    const got = byCheck(run(load(`${doc.id}.pdf.json`)));
    const checks = doc.checks as Record<string, Expectation>;
    for (const id of DETERMINISTIC) {
      const exp = checks[id]!;
      const ok = got[id] === exp.expected || (exp.also_ok ?? []).includes(got[id]!);
      if (!ok) mismatches.push({ list: doc.id, check: id, got: got[id]!, expected: exp.expected });
      if (exp.expected !== 'pass' || got[id] !== 'pass') {
        rows.push({ list: doc.id, check: id, expected: [exp.expected, ...(exp.also_ok ?? [])].join('|'), got: got[id]!, ok: ok ? '' : 'MISMATCH' });
      }
    }
  }

  it('matches labels except the documented deviations', () => {
    console.table(rows);
    const key = (m: { list: string; check: string; got: string }) => `${m.list} ${m.check} -> ${m.got}`;
    expect(mismatches.map(key).sort()).toEqual(KNOWN_DEVIATIONS.map(key).sort());
  });

  it('never fails a check whose label is pass or not_applicable', () => {
    expect(mismatches.filter((m) => m.got === 'fail')).toEqual([]);
  });
});

describe('hard gates', () => {
  it.each(['syn-01', 'syn-02', 'syn-10', 'syn-12'])('%s has zero fails', (list) => {
    expect(fails(run(load(`${list}.pdf.json`)))).toEqual([]);
  });

  it('FTC template fails only on its blanks', () => {
    const r = run(load('ftc-sample1-gpl-template.pdf.json'));
    expect(fails(r)).toEqual(['C-005', 'C-040', 'C-041', 'C-050', 'C-070']);
    const got = byCheck(r);
    const rows = Object.entries(ftcLabels.documents[0]!.checks as Record<string, Expectation>)
      .filter(([id]) => DETERMINISTIC.includes(id))
      .map(([id, e]) => ({ check: id, expected: [e.expected, ...(e.also_ok ?? [])].join('|'), got: got[id] }));
    console.table(rows);
    for (const row of rows) expect(row.expected.split('|'), row.check).toContain(row.got);
  });

  it('every finding carries its citation and plain text', () => {
    const docs = [...SYN_LISTS.map((l) => `${l}.pdf.json`), 'ftc-sample1-gpl-template.pdf.json'];
    for (const file of docs) {
      for (const f of run(load(file)).findings) {
        const check = ruleset.checks.find((c) => c.id === f.checkId)!;
        expect(f.plain.trim(), f.checkId).not.toBe('');
        expect(f.cite, f.checkId).toBe(check.cite);
        if (check.cite === null) expect(f.basis, f.checkId).toBe('heuristic');
        expect(f.reason, f.checkId).not.toMatch(/violat/i);
      }
    }
  });

  it.each(PHOTO_LISTS)('photos of %s never fail a check its PDF passes', (list) => {
    const pdf = byCheck(run(load(`${list}.pdf.json`)));
    const photo = byCheck(run(mergePhotos(list)));
    const bad = DETERMINISTIC.filter((id) => (pdf[id] === 'pass' || pdf[id] === 'not_applicable') && photo[id] === 'fail');
    expect(bad).toEqual([]);
  });
});

describe('photo verdicts versus PDF (informational)', () => {
  it.each([['meta-api', ''], ['open-weights', 'open-weights']])('prints where %s photo verdicts differ from the PDF', (_name, dir) => {
    const rows: Record<string, string>[] = [];
    for (const list of PHOTO_LISTS) {
      const pdf = byCheck(run(load(`${list}.pdf.json`)));
      const photo = byCheck(run(mergePhotos(list, dir)));
      for (const id of DETERMINISTIC) if (pdf[id] !== photo[id]) rows.push({ list, check: id, pdf: pdf[id]!, photo: photo[id]! });
    }
    console.table(rows);
  });
});

describe('option classification', () => {
  it('reviews rather than fails a purchaser option worded outside the known patterns', () => {
    const x = load('syn-01.pdf.json');
    const relabeled = {
      ...x,
      items: x.items.map((i) =>
        i.label.startsWith('A. Direct cremation') ? { ...i, label: 'A. Direct cremation, customer-furnished container' } : i,
      ),
    };
    expect(byCheck(run(relabeled))['C-040']).toBe('review');
  });
});
