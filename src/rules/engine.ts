import { DISCLOSURE_IDS, type GplExtraction } from '../extraction';
import { CHECKS, type CheckContext, type DeterministicCheckId } from './checks';
import { evaluateConditions, type Matches } from './conditions';
import { buildCorpus, matchCompleteList, matchDisclosure } from './text';
import { VERDICTS, type Finding, type Outcome, type Report, type Ruleset, type RulesetCheck, type Verdict } from './types';

export type RunOptions = { auditDate: Date };

// Only a deterministic check that cites Rule text and is declared fail-capable may fail.
const canFail = (c: RulesetCheck) => c.basis === 'rule' && c.engine === 'deterministic' && c.on_violation === 'fail';

function verdictOf(c: RulesetCheck, o: Outcome): { verdict: Verdict; reason: string } {
  switch (o.result) {
    case 'met':
      return { verdict: 'pass', reason: o.reason };
    case 'not_applicable':
      return { verdict: 'not_applicable', reason: o.reason };
    case 'uncertain':
      return { verdict: 'review', reason: `extraction_uncertain: ${o.reason}` };
    case 'violation':
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
    if (check.engine !== 'deterministic') {
      notRun.push(check.id);
      continue;
    }
    const fn = CHECKS[check.id as DeterministicCheckId];
    if (!fn) throw new Error(`no implementation for deterministic check ${check.id}`);
    const raw = fn(ctx);
    for (const o of Array.isArray(raw) ? raw : [raw]) {
      findings.push({
        checkId: check.id,
        ...verdictOf(check, o),
        title: check.title,
        cite: check.cite,
        basis: check.basis,
        plain: check.plain,
        evidence: o.evidence,
      });
    }
  }

  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
  for (const f of findings) counts[f.verdict]++;
  return { rulesetId: ruleset.id, rulesetVersion: ruleset.version, findings, counts, notRun };
}
