import ruleset from '../../prep/rules/ftc-453@2026.1.json';
import type { GplExtraction } from '../extraction';
import { CHECKS, type CheckContext, type DeterministicCheckId } from './checks';
import { itemsOf } from './conditions';
import { descriptionOf, normalize } from './text';
import type { Evidence, Outcome } from './types';

// Bump on any change to the prompt or schema: it is part of the semantic cache key.
export const SEMANTIC_PROMPT_VERSION = 'semantic-5';

export const SEMANTIC_CHECK_IDS = [
  'C-011', 'C-021', 'C-025', 'C-031', 'C-032', 'C-045', 'C-046', 'C-047', 'C-075', 'C-080', 'C-081', 'C-082', 'C-083',
] as const;
export type SemanticCheckId = (typeof SEMANTIC_CHECK_IDS)[number];

export type SemanticJudgment = {
  id: SemanticCheckId;
  applies: boolean;
  concern: boolean;
  quote: string | null;
  page: number | null;
  explanation: string;
};

// One judgment per semantic check; a parsed result always has all 13.
export type SemanticResults = Record<SemanticCheckId, SemanticJudgment>;

const nullable = (type: string) => ({ type: [type, 'null'] });

export const SEMANTIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['checks'],
  properties: {
    checks: {
      type: 'array',
      minItems: SEMANTIC_CHECK_IDS.length,
      maxItems: SEMANTIC_CHECK_IDS.length,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'applies', 'concern', 'quote', 'page', 'explanation'],
        properties: {
          id: { type: 'string', enum: [...SEMANTIC_CHECK_IDS] },
          applies: { type: 'boolean' },
          concern: { type: 'boolean' },
          quote: nullable('string'),
          page: nullable('integer'),
          explanation: { type: 'string' },
        },
      },
    },
  },
} as const;

export class SemanticError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseSemantic(json: unknown): SemanticResults {
  if (!isObj(json) || !Array.isArray(json.checks)) throw new SemanticError('$.checks: expected array');
  const out: Partial<SemanticResults> = {};
  for (const [i, raw] of json.checks.entries()) {
    if (!isObj(raw)) throw new SemanticError(`checks[${i}]: expected object`);
    const { id, applies, concern, quote, page, explanation } = raw;
    if (typeof id !== 'string' || !(SEMANTIC_CHECK_IDS as readonly string[]).includes(id)) throw new SemanticError(`checks[${i}].id: unknown`);
    if (out[id as SemanticCheckId]) throw new SemanticError(`checks[${i}].id: duplicate ${id}`);
    if (typeof applies !== 'boolean' || typeof concern !== 'boolean') throw new SemanticError(`checks[${i}]: expected booleans`);
    if (quote !== null && typeof quote !== 'string') throw new SemanticError(`checks[${i}].quote: expected string or null`);
    if (page !== null && !(Number.isInteger(page) && (page as number) >= 1)) throw new SemanticError(`checks[${i}].page: expected page or null`);
    if (typeof explanation !== 'string') throw new SemanticError(`checks[${i}].explanation: expected string`);
    out[id as SemanticCheckId] = { id: id as SemanticCheckId, applies, concern, quote, page: page as number | null, explanation };
  }
  const missing = SEMANTIC_CHECK_IDS.filter((id) => !out[id]);
  if (missing.length) throw new SemanticError(`missing checks: ${missing.join(', ')}`);
  return out as SemanticResults;
}

// --- Prompt: static instructions and check definitions first so providers can cache the prefix.

type Segment = { kind: string; t?: string; name?: string };
const disclosureText = (segments: readonly Segment[]) =>
  segments.map((s) => (s.kind === 'slot' ? `[${s.name}]` : s.t)).join(' ');

const CHECK_DEFS = ruleset.checks
  .filter((c) => (SEMANTIC_CHECK_IDS as readonly string[]).includes(c.id))
  .map((c) => ({ id: c.id, title: c.title, applies_when: c.applies_when, test: c.test, plain: c.plain }));

const DISCLOSURE_DEFS = Object.entries(ruleset.disclosures)
  .map(([id, d]) => `- ${id} (${d.title}): ${disclosureText(d.segments as readonly Segment[])}`)
  .join('\n');

export const SEMANTIC_SYSTEM_PROMPT = `You review a funeral home's General Price List (GPL) for a compliance tool. Another model transcribed the list into JSON; you get that JSON and ${SEMANTIC_CHECK_IDS.length} checks. Answer every check exactly once.

For each check:
- "applies": whether the check's applies_when condition holds for this list. "always" means true. "packages present" means the list offers a package (see C-080's test).
- "concern": true only when text printed on the list affirmatively shows what the check's test describes. If the list is silent on it, concern is false. Do not raise a concern about something the list leaves out unless the test itself is about something missing. Wording that differs from a model disclosure is not by itself a concern.
- "quote": when concern is true, the shortest passage that shows it, copied character for character from ONE string value in the JSON (a label, priceText, includesText, or disclosure text). Do not join text from two values, paraphrase, or add ellipses. null when concern is false.
- "page": the page of the quoted text, or null.
- "explanation": one or two plain sentences saying what you saw. Describe the text; do not conclude that anything is illegal. Never use the words "violate", "violation" or "illegal".

About the input:
- "items" and "disclosures" are separate arrays, each in document order, but their order relative to each other within a page is not recorded. For placement checks (C-011, C-031, C-045), a disclosure on the same page as the prices it accompanies counts as placed correctly; raise a concern only when it is on a different page.
- A disclosure with id "unknown" is other notice text printed on the list.
- The Funeral Rule prescribes the disclosures below. Their own wording, or a close variant of it, is never a concern for any check: for example "embalming is not required by law" and "state or local law does not require that you buy a container" are required statements, not claims that a purchase is required.
${DISCLOSURE_DEFS}

Checks:
${JSON.stringify(CHECK_DEFS, null, 1)}`;

export const semanticUserText = (x: GplExtraction) => `General Price List as transcribed:\n${JSON.stringify(x)}`;

// --- Engine side: turn a judgment into an Outcome. The engine maps Outcome to Verdict, and
// a semantic check can never fail there because only deterministic checks may.

type Applicability = 'yes' | 'no' | 'ask_model';
const metDet = (ctx: CheckContext, id: DeterministicCheckId) => {
  const o = CHECKS[id](ctx);
  return (Array.isArray(o) ? o : [o]).every((x) => x.result === 'met');
};
const yesNo = (b: boolean): Applicability => (b ? 'yes' : 'no');

// applies_when, evaluated by the engine wherever the extraction already settles it. A placement
// check needs its disclosure to have passed its own presence check: labels.json treats a missing,
// paraphrased or unfilled disclosure as having no placement to judge.
const APPLIES: Record<SemanticCheckId, (ctx: CheckContext) => Applicability> = {
  'C-011': (ctx) => yesNo(metDet(ctx, 'C-010')),
  'C-021': (ctx) => yesNo(ctx.cond.basic_services_priced && itemsOf(ctx.x, 'basic_services').some((i) => descriptionOf(i, ctx.ruleset) !== null)),
  'C-025': () => 'yes',
  'C-031': (ctx) => yesNo(metDet(ctx, 'C-030')),
  'C-032': () => 'yes',
  'C-045': (ctx) => yesNo(metDet(ctx, 'C-044')),
  'C-046': (ctx) => yesNo(ctx.cond.direct_cremation_offered),
  'C-047': (ctx) => yesNo(ctx.cond.direct_cremation_offered),
  'C-075': () => 'yes',
  'C-080': () => 'ask_model',
  'C-081': () => 'yes',
  'C-082': () => 'yes',
  'C-083': () => 'yes',
};

// Model text lands in finding.reason; the API must never call a list a violation.
export const tame = (s: string) =>
  s
    .trim()
    .replace(/\bviolat(es|ed|ing)\b/gi, (_m, suffix: string) => `conflict${suffix === 'es' ? 's' : suffix} with`)
    .replace(/\bviolat\w*/gi, 'conflict');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type QuoteSource = { text: string; page: number };
const quoteSources = (x: GplExtraction): QuoteSource[] => [
  ...x.disclosures.map((d) => ({ text: d.text, page: d.page })),
  ...x.items.flatMap((i) => [
    { text: i.label, page: i.page },
    ...(i.priceText ? [{ text: i.priceText, page: i.page }, { text: `${i.label}: ${i.priceText}`, page: i.page }] : []),
    ...(i.includesText ? [{ text: i.includesText, page: i.page }] : []),
  ]),
];

// Finds `quote` in the extraction ignoring case, punctuation, quote style and spacing, and returns
// the original span so the letter shows the list's own characters.
export function findQuote(x: GplExtraction, quote: string): Evidence | null {
  const tokens = normalize(quote).split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const re = new RegExp(tokens.map(escapeRe).join('[^\\p{L}\\p{N}$]+'), 'iu');
  const sources = quoteSources(x);
  const exact = sources.find((s) => s.text.includes(quote));
  if (exact) return { quote, page: exact.page };
  for (const s of sources) {
    const m = re.exec(s.text.normalize('NFKC'));
    if (m) return { quote: m[0], page: s.page };
  }
  return null;
}

export function semanticOutcome(ctx: CheckContext, j: SemanticJudgment): Outcome {
  const said = `model: ${tame(j.explanation)}`;
  const applies = APPLIES[j.id](ctx);
  const none: Evidence = { quote: null, page: null };
  if (applies === 'no') return { result: 'not_applicable', reason: 'the list does not meet this check’s applies-when condition', evidence: none };
  if (applies === 'ask_model' && !j.applies) return { result: 'not_applicable', reason: said, evidence: none };
  if (!j.concern) return { result: 'met', reason: said, evidence: none };
  const found = j.quote ? findQuote(ctx.x, j.quote) : null;
  if (found) return { result: 'violation', reason: said, evidence: found };
  const why = j.quote ? `the model's quote was not found in the transcribed list ("${tame(j.quote)}")` : 'the model gave no quote';
  return { result: 'violation', reason: `${why}; ${said}`, evidence: none };
}
