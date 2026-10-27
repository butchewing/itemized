import type { DisclosureId, GplExtraction } from '../extraction';
import type { CompleteListMatch, DisclosureMatch, Evidence, Ruleset, SegmentStatus, SlotFill } from './types';

export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s$]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Window = { start: number; end: number; score: number };

// Ratio 2*LCS/(|a|+|b|), the same family as difflib's ratio.
function lcsRatio(a: string, b: string): number {
  if (a.length + b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = ca === b.charCodeAt(j - 1) ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    [prev, cur] = [cur, prev];
  }
  return (2 * prev[b.length]!) / (a.length + b.length);
}

// Best-matching window of `text` for `pattern`: semi-global edit-distance alignment (free start
// and end in text), then scored by LCS ratio against that window. Character-level on purpose: a
// token score would push "This fee is for our basic services" (accepted drift) out of the match band.
export function align(pattern: string, text: string, from = 0): Window {
  const m = pattern.length;
  const n = text.length - from;
  if (m === 0 || n <= 0) return { start: from, end: from, score: 0 };
  let prevD = new Int32Array(n + 1);
  let prevS = new Int32Array(n + 1);
  let curD = new Int32Array(n + 1);
  let curS = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prevS[j] = j;
  for (let i = 1; i <= m; i++) {
    const pc = pattern.charCodeAt(i - 1);
    curD[0] = i;
    curS[0] = 0;
    for (let j = 1; j <= n; j++) {
      let d = prevD[j - 1]! + (pc === text.charCodeAt(from + j - 1) ? 0 : 1);
      let s = prevS[j - 1]!;
      const del = prevD[j]! + 1;
      if (del < d) [d, s] = [del, prevS[j]!];
      const ins = curD[j - 1]! + 1;
      if (ins < d) [d, s] = [ins, curS[j - 1]!];
      curD[j] = d;
      curS[j] = s;
    }
    [prevD, curD] = [curD, prevD];
    [prevS, curS] = [curS, prevS];
  }
  let best = 1;
  for (let j = 2; j <= n; j++) if (prevD[j]! < prevD[best]!) best = j;
  const start = prevS[best]!;
  return { start: from + start, end: from + best, score: lcsRatio(pattern, text.slice(from + start, from + best)) };
}

export const similarity = (pattern: string, text: string) => align(normalize(pattern), normalize(text)).score;

type Block = { orig: string; norm: string; start: number; end: number; page: number; modelId: string | null };

export type Corpus = { text: string; blocks: Block[] };

// Disclosure blocks in document order, then item "includes" paragraphs, where a model sometimes
// files a disclosure. The extraction has no raw page text yet; when it does, it belongs here.
export function buildCorpus(x: GplExtraction): Corpus {
  const sources = [
    ...x.disclosures.map((d) => ({ orig: d.text, page: d.page, modelId: d.id as string })),
    ...x.items.filter((i) => i.includesText?.trim()).map((i) => ({ orig: i.includesText!, page: i.page, modelId: null })),
  ];
  const blocks: Block[] = [];
  let text = '';
  for (const s of sources) {
    const norm = normalize(s.orig);
    if (!norm) continue;
    if (text) text += ' ';
    blocks.push({ ...s, norm, start: text.length, end: text.length + norm.length });
    text += norm;
  }
  return { text, blocks };
}

const blockAt = (c: Corpus, pos: number) => c.blocks.find((b) => pos >= b.start && pos < b.end) ?? null;

const evidenceOf = (b: Block | null, id?: string): Evidence => ({
  quote: b?.orig ?? null,
  page: b?.page ?? null,
  ...(id && { disclosureId: id }),
});

export type Thresholds = { match: number; altered: number };

const statusOf = (score: number, t: Thresholds): SegmentStatus =>
  score >= t.match ? 'present' : score >= t.altered ? 'altered' : 'absent';

const LONG_SEGMENT = 60;

const MARKER = /^(specify|insert|list|describe|enter|name|add)\b/;

export function slotFill(raw: string): SlotFill {
  const text = raw.trim();
  if (!text) return { text, state: 'empty' };
  if (!/[\p{L}\p{N}]/u.test(text) || MARKER.test(text)) return { text, state: 'marker' };
  return { text, state: 'filled' };
}

// JSON imports widen `kind` to string, so the segment shape is restated here.
type Segment =
  | { kind: 'fixed'; t: string }
  | { kind: 'optional'; t: string }
  | { kind: 'conditional'; t: string; when: string }
  | { kind: 'slot'; name: string; max_chars: number };

const segText = (s: Segment) => (s.kind === 'slot' ? '' : normalize(s.t));

export function matchDisclosure(c: Corpus, ruleset: Ruleset, id: DisclosureId): DisclosureMatch {
  const t = ruleset.text_matching.thresholds;
  const segments = ruleset.disclosures[id].segments as readonly Segment[];
  const fixedIdx = segments.flatMap((s, i) => (s.kind === 'fixed' ? [i] : []));
  const found = new Map<number, Window>();
  let cursor = 0;
  for (const i of fixedIdx) {
    const w = align(segText(segments[i]!), c.text, cursor);
    found.set(i, w);
    if (w.score >= t.altered) cursor = w.end;
  }
  const isFound = (i: number | undefined) => i !== undefined && found.get(i)!.score >= t.altered;

  const optional: Record<string, boolean> = {};
  const conditional: Record<string, SegmentStatus> = {};
  const slots: Record<string, SlotFill> = {};
  segments.forEach((s, i) => {
    if (s.kind === 'fixed') return;
    const before = fixedIdx.filter((f) => f < i).at(-1);
    const after = fixedIdx.find((f) => f > i);
    let region: string | null = null;
    if (before !== undefined && after !== undefined) {
      if (isFound(before) && isFound(after) && found.get(after)!.start >= found.get(before)!.end) {
        region = c.text.slice(found.get(before)!.end, found.get(after)!.start);
      }
    } else if (after !== undefined) {
      if (isFound(after)) {
        const w = found.get(after)!;
        const floor = Math.max(blockAt(c, w.start)?.start ?? 0, w.start - segText(s).length - 30);
        region = c.text.slice(floor, w.start);
      }
    } else if (before !== undefined && isFound(before)) {
      const w = found.get(before)!;
      const block = blockAt(c, Math.max(w.end - 1, 0));
      const max = s.kind === 'slot' ? s.max_chars : 200;
      region = c.text.slice(w.end, Math.min(block?.end ?? w.end, w.end + max));
    }

    if (s.kind === 'slot') {
      slots[s.name] = region === null ? { text: '', state: 'empty' } : slotFill(region);
    } else if (s.kind === 'optional') {
      optional[s.t] = region !== null && align(segText(s), region).score >= t.match;
    } else if (s.kind === 'conditional') {
      conditional[s.when] = region === null ? 'absent' : statusOf(align(segText(s), region).score, t);
    }
  });

  const scores = fixedIdx.map((i) => found.get(i)!.score);
  const lengths = fixedIdx.map((i) => segText(segments[i]!).length);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  // A short segment ("This fee for our basic services") scores in the altered band against
  // unrelated wording, so partial presence needs length behind it.
  const weighted = scores.reduce((sum, s, k) => sum + s * lengths[k]!, 0) / lengths.reduce((a, b) => a + b, 0);
  const longHit = scores.some((s, k) => s >= t.altered && lengths[k]! >= LONG_SEGMENT);
  const status: SegmentStatus =
    min >= t.match ? 'present' : weighted >= t.altered || longHit ? 'altered' : 'absent';
  const bestIdx = fixedIdx[scores.indexOf(max)]!;
  const bestBlock = blockAt(c, found.get(bestIdx)!.start);
  const fmt = (n: number) => n.toFixed(2);

  if (status === 'absent') {
    const tagged = c.blocks.find((b) => b.modelId === id);
    if (tagged) {
      return {
        id, status: 'altered', score: min, segmentScores: scores, optional, conditional, slots,
        evidence: evidenceOf(tagged, id),
        reason: `the extractor labeled a block as this disclosure, but its wording does not match the Rule text (best score ${fmt(max)})`,
      };
    }
  }
  const reason =
    status === 'present'
      ? `matches the Rule text (lowest segment score ${fmt(min)})`
      : status === 'altered'
        ? `partly matches the Rule text (segment scores ${scores.map(fmt).join(', ')}); wording differs or was misread`
        : `not found in any extracted disclosure text (best score ${fmt(max)})`;
  return {
    id, status, score: min, segmentScores: scores, optional, conditional, slots,
    evidence: status === 'absent' ? { quote: null, page: null, disclosureId: id } : evidenceOf(bestBlock, id),
    reason,
  };
}

// Models sometimes file a required disclosure, such as the basic services fee statement, as an
// item's "includes" text. That text describes no services, so it only counts as a description when
// something substantial is left after the Rule's wording is cut out.
const MIN_DESCRIPTION_WORDS = 3;
export function isDescription(includesText: string | null, ruleset: Ruleset): boolean {
  let s = normalize(includesText ?? '');
  if (!s) return false;
  const t = ruleset.text_matching.thresholds;
  let cut = false;
  for (const d of Object.values(ruleset.disclosures)) {
    for (const seg of d.segments as readonly Segment[]) {
      if (seg.kind === 'slot') continue;
      const w = align(segText(seg), s);
      if (w.score < t.match) continue;
      s = `${s.slice(0, w.start)} ${s.slice(w.end)}`.replace(/\s+/g, ' ').trim();
      cut = true;
    }
  }
  return !cut || s.split(' ').filter(Boolean).length >= MIN_DESCRIPTION_WORDS;
}

const COMPLETE_LIST_IDS: readonly string[] = ['D-casket-list', 'D-obc-list'];

// D-casket-list and D-obc-list are the same sentence, so occurrences are counted, not matched by id.
export function matchCompleteList(c: Corpus, ruleset: Ruleset): CompleteListMatch {
  const t = ruleset.text_matching.thresholds;
  const seg = ruleset.disclosures['D-casket-list'].segments[0];
  const pattern = normalize(seg.t);
  let present = 0;
  let altered = 0;
  let first: Block | null = null;
  for (const b of c.blocks) {
    let pos = 0;
    while (pos < b.norm.length) {
      const w = align(pattern, b.norm, pos);
      if (w.score < t.altered || w.end <= pos) break;
      if (w.score >= t.match) present++;
      else altered++;
      first ??= b;
      pos = w.end;
    }
  }
  if (present + altered === 0) {
    const tagged = c.blocks.find((b) => b.modelId !== null && COMPLETE_LIST_IDS.includes(b.modelId));
    if (tagged) return { present: 0, altered: 1, evidence: evidenceOf(tagged, tagged.modelId!) };
  }
  return { present, altered, evidence: evidenceOf(first, first ? 'D-casket-list' : undefined) };
}
