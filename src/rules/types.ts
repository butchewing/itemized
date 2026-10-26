import type rulesetJson from '../../prep/rules/ftc-453@2026.1.json';
import type { DisclosureId } from '../extraction';

export type Ruleset = typeof rulesetJson;
export type RulesetCheck = Ruleset['checks'][number];

export const VERDICTS = ['fail', 'review', 'pass', 'not_applicable'] as const;
export type Verdict = (typeof VERDICTS)[number];

export type Evidence = {
  quote: string | null;
  page: number | null;
  itemCategory?: string;
  disclosureId?: string;
};

export type Finding = {
  checkId: string;
  verdict: Verdict;
  title: string;
  cite: string | null;
  basis: string;
  plain: string;
  evidence: Evidence;
  reason: string;
};

export type Report = {
  rulesetId: string;
  rulesetVersion: string;
  findings: Finding[];
  counts: Record<Verdict, number>;
  // Checks the engine does not run yet (semantic, model-judged).
  notRun: string[];
};

// What a check function concludes; the engine turns it into a Verdict using the ruleset.
// `violation` becomes the check's on_violation; `uncertain` is always review.
export type Outcome = {
  result: 'met' | 'violation' | 'uncertain' | 'not_applicable';
  reason: string;
  evidence: Evidence;
};

export type SegmentStatus = 'present' | 'altered' | 'absent';

export type SlotFill = { text: string; state: 'filled' | 'marker' | 'empty' };

export type DisclosureMatch = {
  id: DisclosureId;
  status: SegmentStatus;
  // Lowest fixed-segment score; 0 when nothing aligned.
  score: number;
  segmentScores: number[];
  optional: Record<string, boolean>;
  conditional: Record<string, SegmentStatus>;
  slots: Record<string, SlotFill>;
  evidence: Evidence;
  reason: string;
};

export type CompleteListMatch = { present: number; altered: number; evidence: Evidence };
