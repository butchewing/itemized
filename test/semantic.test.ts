import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ruleset from '../prep/rules/ftc-453@2026.1.json';
import synLabels from '../prep/synthetic/labels.json';
import { parseExtraction, type GplExtraction } from '../src/extraction';
import { renderLetterHtml } from '../src/letter';
import { DETERMINISTIC_CHECK_IDS } from '../src/rules/checks';
import { runChecks } from '../src/rules/engine';
import {
  findQuote,
  parseSemantic,
  SEMANTIC_CHECK_IDS,
  SemanticError,
  type SemanticCheckId,
  type SemanticJudgment,
  type SemanticResults,
} from '../src/rules/semantic';
import type { Finding, Report, Verdict } from '../src/rules/types';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const AUDIT_DATE = new Date('2026-10-26T00:00:00Z');
const SEMANTIC = ruleset.checks.filter((c) => c.engine !== 'deterministic').map((c) => c.id);

const loadX = (list: string): GplExtraction =>
  parseExtraction(JSON.parse(readFileSync(join(FIXTURES, 'extractions', `${list}.pdf.json`), 'utf8')));
const loadS = (list: string): SemanticResults =>
  parseSemantic(JSON.parse(readFileSync(join(FIXTURES, 'semantic', `${list}.pdf.json`), 'utf8')));
const run = (x: GplExtraction, semantic?: SemanticResults | null) => runChecks(x, ruleset, { auditDate: AUDIT_DATE, semantic });
const findingOf = (r: Report, id: string) => r.findings.find((f) => f.checkId === id)!;
const semanticFindings = (r: Report) => r.findings.filter((f) => (SEMANTIC_CHECK_IDS as readonly string[]).includes(f.checkId));

function judgments(over: Partial<SemanticJudgment> = {}): SemanticResults {
  return Object.fromEntries(
    SEMANTIC_CHECK_IDS.map((id) => [id, { id, applies: true, concern: false, quote: null, page: null, explanation: 'nothing found', ...over }]),
  ) as SemanticResults;
}
const withOne = (id: SemanticCheckId, j: Partial<SemanticJudgment>): SemanticResults => {
  const all = judgments();
  return { ...all, [id]: { ...all[id], ...j } };
};

describe('registry', () => {
  it('covers every non-deterministic ruleset check, and the two sets cover the ruleset', () => {
    expect([...SEMANTIC_CHECK_IDS].sort()).toEqual([...SEMANTIC].sort());
    expect([...SEMANTIC_CHECK_IDS, ...DETERMINISTIC_CHECK_IDS].sort()).toEqual(ruleset.checks.map((c) => c.id).sort());
  });
});

describe('a semantic check can never fail', () => {
  // Lists that exercise every applies_when gate both ways (syn-03 and syn-11 close the placement gates).
  const lists = ['syn-01', 'syn-03', 'syn-10', 'syn-11', 'syn-12'];
  const quotes = [null, 'Embalming', 'text that is not on any list'];
  it.each(lists)('%s: every id x applies x concern x quote yields review, pass or not_applicable', (list) => {
    const x = loadX(list);
    const seen = new Set<Verdict>();
    for (const id of SEMANTIC_CHECK_IDS) {
      for (const applies of [true, false]) {
        for (const concern of [true, false]) {
          for (const quote of quotes) {
            const f = findingOf(run(x, withOne(id, { applies, concern, quote, explanation: 'This violates the Rule.' })), id);
            expect(['review', 'pass', 'not_applicable'], `${id} ${applies} ${concern} ${quote}`).toContain(f.verdict);
            expect(f.reason).not.toMatch(/violat/i);
            seen.add(f.verdict);
          }
        }
      }
    }
    expect(seen.has('fail')).toBe(false);
    // 156 full engine runs per list; the default 5s budget is too tight for a property sweep.
  }, 30_000);

  it('maps concern to review and no concern to pass when the check applies', () => {
    const x = loadX('syn-01');
    expect(findingOf(run(x, withOne('C-082', { concern: true, quote: 'Embalming' })), 'C-082').verdict).toBe('review');
    expect(findingOf(run(x, withOne('C-082', { concern: false })), 'C-082').verdict).toBe('pass');
  });

  it('takes applies from the model only where the engine cannot evaluate applies_when', () => {
    const x = loadX('syn-01');
    expect(findingOf(run(x, withOne('C-080', { applies: false, concern: true })), 'C-080').verdict).toBe('not_applicable');
    // "always" checks apply whatever the model says.
    expect(findingOf(run(x, withOne('C-025', { applies: false, concern: true, quote: 'Embalming' })), 'C-025').verdict).toBe('review');
    // syn-03 has no embalming disclosure, so embalming placement is not applicable even if the model judges it.
    expect(findingOf(run(loadX('syn-03'), withOne('C-031', { concern: true })), 'C-031').verdict).toBe('not_applicable');
  });
});

describe('quote verification', () => {
  const x = loadX('syn-10');
  const claim = 'Please note: state law requires embalming before any cremation performed by our firm.';

  it('keeps an exact quote and takes the page from the list', () => {
    expect(findQuote(x, claim)).toEqual({ quote: claim, page: 2 });
  });

  it('matches across case, quote style, punctuation and spacing, and stores the list’s own text', () => {
    expect(findQuote(x, '“STATE LAW  requires embalming before any cremation”')).toEqual({
      quote: 'state law requires embalming before any cremation',
      page: 2,
    });
    expect(findQuote(x, 'Casket Handling Fee (applies when a casket is purchased elsewhere): $295')?.quote).toBe(
      'Casket Handling Fee (applies when a casket is purchased elsewhere): $295',
    );
  });

  it('returns null for a quote that is not on the list', () => {
    expect(findQuote(x, 'state law requires a sealed vault')).toBeNull();
  });

  it('keeps an unverified concern as review with no quote and says why', () => {
    const f = findingOf(run(x, withOne('C-081', { concern: true, quote: 'state law requires a sealed vault', page: 2 })), 'C-081');
    expect(f.verdict).toBe('review');
    expect(f.evidence).toEqual({ quote: null, page: null });
    expect(f.reason).toMatch(/not found in the transcribed list/);
  });

  it('verifies a concern’s quote into the evidence, ending the span at its last word', () => {
    const f = findingOf(run(x, withOne('C-081', { concern: true, quote: claim.toLowerCase(), page: 1 })), 'C-081');
    expect(f.evidence).toEqual({ quote: claim.slice(0, -1), page: 2 });
  });
});

describe('without semantic results', () => {
  it.each([undefined, null])('semantic=%s leaves the 13 checks in notRun and the report valid', (semantic) => {
    const r = run(loadX('syn-10'), semantic);
    expect([...r.notRun].sort()).toEqual([...SEMANTIC].sort());
    expect(semanticFindings(r)).toEqual([]);
    expect(r.counts.fail + r.counts.review + r.counts.pass + r.counts.not_applicable).toBe(r.findings.length);
  });
});

describe('parseSemantic', () => {
  const raw = (checks: unknown[]) => ({ checks });
  const row = (id: string) => ({ id, applies: true, concern: false, quote: null, page: null, explanation: '' });
  it('rejects missing, duplicate and unknown ids', () => {
    const all = SEMANTIC_CHECK_IDS.map(row);
    expect(() => parseSemantic(raw(all.slice(1)))).toThrow(SemanticError);
    expect(() => parseSemantic(raw([...all.slice(1), row('C-025')]))).toThrow(SemanticError);
    expect(() => parseSemantic(raw([...all.slice(1), row('C-001')]))).toThrow(SemanticError);
    expect(Object.keys(parseSemantic(raw(all)))).toHaveLength(13);
  });
});

type Expectation = { expected: string; also_ok?: string[] };

// Mismatches against labels.json for the semantic checks that are deliberate; must match exactly.
const KNOWN_DEVIATIONS: { list: string; check: string; got: Verdict; reason: string }[] = [];

describe('semantic fixtures (muse-spark-1.3, low effort) against labels.json', () => {
  const rows: Record<string, string>[] = [];
  const mismatches: { list: string; check: string; got: Verdict }[] = [];
  const reports: Record<string, Report> = {};
  for (const doc of synLabels.documents) {
    const r = run(loadX(doc.id), loadS(doc.id));
    reports[doc.id] = r;
    const checks = doc.checks as Record<string, Expectation>;
    for (const id of SEMANTIC_CHECK_IDS) {
      const exp = checks[id]!;
      const got = findingOf(r, id).verdict;
      const ok = got === exp.expected || (exp.also_ok ?? []).includes(got);
      if (!ok) mismatches.push({ list: doc.id, check: id, got });
      if (exp.expected !== 'pass' || got !== 'pass') {
        rows.push({ list: doc.id, check: id, expected: [exp.expected, ...(exp.also_ok ?? [])].join('|'), got, ok: ok ? '' : 'MISMATCH' });
      }
    }
  }

  it('matches labels except the documented deviations', () => {
    console.table(rows);
    const key = (m: { list: string; check: string; got: string }) => `${m.list} ${m.check} -> ${m.got}`;
    expect(mismatches.map(key).sort()).toEqual(KNOWN_DEVIATIONS.map(key).sort());
  });

  it('runs all 13 checks, so notRun is empty and the letter drops its not-run line', () => {
    for (const r of Object.values(reports)) expect(r.notRun).toEqual([]);
    const html = renderLetterHtml({ extraction: loadX('syn-10'), report: reports['syn-10']!, modelName: 'Muse Spark 1.3', date: AUDIT_DATE });
    expect(html).not.toMatch(/not part of this review yet/);
  });

  const reviews = (r: Report) => semanticFindings(r).filter((f) => f.verdict === 'review');
  it.each(['syn-01', 'syn-12'])('%s has zero semantic reviews', (list) => {
    expect(reviews(reports[list]!).map((f) => f.checkId)).toEqual([]);
  });

  it('syn-10 surfaces its labeled reviews, each with a quote verified on the list', () => {
    const got = new Map<string, Finding>(reviews(reports['syn-10']!).map((f) => [f.checkId, f]));
    for (const id of ['C-025', 'C-032', 'C-081', 'C-082']) {
      expect(got.get(id)?.verdict, id).toBe('review');
      expect(got.get(id)?.evidence.quote, id).toBeTruthy();
    }
  });

  it('semantic findings carry the ruleset’s own title, cite and plain text', () => {
    for (const r of Object.values(reports)) {
      for (const f of semanticFindings(r)) {
        const c = ruleset.checks.find((k) => k.id === f.checkId)!;
        expect([f.title, f.cite, f.plain, f.basis]).toEqual([c.title, c.cite, c.plain, c.basis]);
        expect(f.reason).not.toMatch(/violat/i);
      }
    }
  });
});
