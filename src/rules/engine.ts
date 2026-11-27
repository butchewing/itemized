import { DISCLOSURE_IDS, type GplExtraction } from '../extraction';
import { CHECKS, type CheckContext, type DeterministicCheckId } from './checks';
import { evaluateConditions, type Matches } from './conditions';
import { semanticOutcome, type SemanticCheckId, type SemanticResults } from './semantic';
import { isCrematoryNotice, jurisdictionOf, runTexasChecks, TX_RULESET } from './texas';
import { buildCorpus, matchCompleteList, matchDisclosure } from './text';
import { VERDICTS, type Finding, type Outcome, type Report, type Ruleset, type RulesetCheck, type Verdict } from './types';

// `semantic` is null or absent when the model step was skipped or failed; those checks go to notRun.
// Bump on any change to how checks map to verdicts: it is part of the reuse key, so stale reviews are not handed back.
export const ENGINE_VERSION = 'engine-7';

// `input: 'images'` means the list was read from photos, where a statement or price can be missed or misread.
// state: the USPS code the uploader chose, if any; it overrides the list's address.
export type RunOptions = { auditDate: Date; semantic?: SemanticResults | null; input?: 'pdf' | 'images'; state?: string | null };

// Only a deterministic check that cites Rule text and is declared fail-capable may fail.
type CheckDef = Pick<RulesetCheck, 'basis' | 'engine' | 'on_violation'>;
// Only text of law can fail a list: the Funeral Rule ('rule') or a state statute or agency rule.
const LAW = new Set(['rule', 'statute', 'agency_rule']);
const canFail = (c: CheckDef) => LAW.has(c.basis) && c.engine === 'deterministic' && c.on_violation === 'fail';

function verdictOf(c: CheckDef, o: Outcome, input: 'pdf' | 'images'): { verdict: Verdict; reason: string } {
  switch (o.result) {
    case 'met':
      return { verdict: 'pass', reason: o.reason };
    case 'not_applicable':
      return { verdict: 'not_applicable', reason: o.reason };
    case 'uncertain':
      return { verdict: 'review', reason: `extraction_uncertain: ${o.reason}` };
    case 'violation':
      if (input === 'images' && !o.seen) return { verdict: 'review', reason: `photo_uncertain: ${o.reason}` };
      return { verdict: canFail(c) ? 'fail' : 'review', reason: o.reason };
  }
}

export function runChecks(x: GplExtraction, ruleset: Ruleset, opts: RunOptions): Report {
  const corpus = buildCorpus(x);
  const matches = Object.fromEntries(DISCLOSURE_IDS.map((id) => [id, matchDisclosure(corpus, ruleset, id)])) as Matches;
  const ctx: CheckContext = {
    x,
    ruleset,
    matches,
    completeList: matchCompleteList(corpus, ruleset),
    cond: evaluateConditions(x, matches),
    auditDate: opts.auditDate,
  };

  const findings: Finding[] = [];
  const notRun: string[] = [];
  for (const check of ruleset.checks) {
    let raw: Outcome | Outcome[];
    if (check.engine === 'deterministic') {
      const fn = CHECKS[check.id as DeterministicCheckId];
      if (!fn) throw new Error(`no implementation for deterministic check ${check.id}`);
      raw = fn(ctx);
    } else {
      const judgment = opts.semantic?.[check.id as SemanticCheckId];
      if (!judgment) {
        notRun.push(check.id);
        continue;
      }
      raw = semanticOutcome(ctx, judgment);
    }
    for (const o of Array.isArray(raw) ? raw : [raw]) {
      findings.push({
        checkId: check.id,
        ...verdictOf(check, o, opts.input ?? 'pdf'),
        title: check.title,
        cite: check.cite,
        basis: check.basis,
        plain: check.plain,
        evidence: o.evidence,
      });
    }
  }

  // Texas adds its own checks for a Texas provider (src/rules/texas.ts); elsewhere none run.
  const jurisdiction = jurisdictionOf(x, opts.state);
  const texas = runTexasChecks(x, corpus, matches, ruleset.text_matching.thresholds, jurisdiction);
  for (const { check, outcome } of texas) {
    findings.push({
      checkId: check.id,
      ...verdictOf(check, outcome, opts.input ?? 'pdf'),
      title: check.title,
      cite: check.cite,
      basis: check.basis,
      plain: check.plain,
      evidence: outcome.evidence,
    });
  }

  // A combined funeral home and crematory in Texas must print both notices. When the federal
  // contradiction check flags only the crematory's, and TX-003 found it, that is not a contradiction.
  const tx003 = findings.find((f) => f.checkId === 'TX-003');
  for (const f of findings) {
    if (f.checkId === 'C-083' && f.verdict === 'review' && tx003?.verdict === 'pass' && f.evidence.quote && isCrematoryNotice(f.evidence.quote)) {
      f.verdict = 'pass';
      f.reason = 'the second notice is the crematory notice Texas requires (Occupations Code §651.4055(c)), not a contradiction';
    }
  }

  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
  for (const f of findings) counts[f.verdict]++;
  const rulesets = [`${ruleset.id}@${ruleset.version}`, ...(texas.length ? [`${TX_RULESET.id}@${TX_RULESET.version}`] : [])];
  return { rulesetId: ruleset.id, rulesetVersion: ruleset.version, rulesets, jurisdiction, findings, counts, notRun };
}
