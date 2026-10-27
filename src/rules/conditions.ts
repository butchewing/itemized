import type { DisclosureId, ExtractedItem, GplExtraction, ItemCategory } from '../extraction';
import { normalize, splitLabel } from './text';
import type { DisclosureMatch, Ruleset } from './types';

export type ConditionId = keyof Ruleset['conditions'];
export type Conditions = Record<ConditionId, boolean>;

export type Matches = Record<DisclosureId, DisclosureMatch>;

export const itemsOf = (x: GplExtraction, c: ItemCategory) => x.items.filter((i) => i.category === c);

const TWO_PRICES = /\$?\s*\d[\d,]*(?:\.\d+)?\s*(?:to|-|–|—)\s*\$?\s*\d[\d,]*/i;
export const hasRange = (i: ExtractedItem) => i.priceRange !== null || TWO_PRICES.test(i.priceText ?? '');
export const isPriced = (i: ExtractedItem) => i.price !== null || i.priceRange !== null;

// Printed text that means "no price here": blank, underscores, a bracketed template marker, or a
// "call us" phrase. Anything else unparsed (a stray digit, "Included") may be a misread.
const MISSING_PHRASE = /\b(call|contact|ask|upon request|on request|inquire|varies|tbd)\b/i;
export function priceTextIsMissing(t: string | null): boolean {
  if (t === null) return true;
  const s = t.trim();
  if (!/[\p{L}\p{N}]/u.test(s)) return true;
  if (/^\[[^\d\]]*\]$/.test(s)) return true;
  return MISSING_PHRASE.test(s);
}

export type PriceState = 'priced' | 'missing' | 'unclear';
export const priceState = (i: ExtractedItem): PriceState =>
  isPriced(i) ? 'priced' : priceTextIsMissing(i.priceText) ? 'missing' : 'unclear';

// Direct cremation and immediate burial: a header row (the range, or the bare name) and A/B/C options.
export type OptionClass = 'purchaser' | 'alt_container' | 'casket' | 'unknown';

const PURCHASER =
  /\b(provided|furnished|supplied|brought) by (the )?(purchaser|family|customer|client|you)\b|\b(purchaser|family|customer) (provides|furnishes|supplies)\b|\bown (container|casket)\b/;
const CONTAINER_WORDS = /\b(alternative container|container|box|fiberboard|cardboard|corrugated|composition|pressboard|particle ?board|unfinished wood)\b/;
const CASKET = /\bcasket\b/;
// Purchaser wording the PURCHASER pattern missed ("customer-furnished container") must not read as an alternative container.
const PURCHASER_HINT = /\b(purchaser|family|customer|client|own|you|your)\b/;

// Both read the label's head: a description folded into the label is not part of its name.
const labelHead = (i: ExtractedItem) => normalize(splitLabel(i.label).head);

export function isOptionHeader(i: ExtractedItem): boolean {
  const l = labelHead(i);
  return i.priceRange !== null || /^(direct cremation|immediate burial)( without ceremony)?$/.test(l);
}

export function classifyOption(i: ExtractedItem): OptionClass {
  const l = labelHead(i);
  if (PURCHASER.test(l)) return 'purchaser';
  if (PURCHASER_HINT.test(l)) return 'unknown';
  if (CONTAINER_WORDS.test(l) && !CASKET.test(l)) return 'alt_container';
  if (CASKET.test(l)) return 'casket';
  return 'unknown';
}

export const optionsOf = (x: GplExtraction, c: 'direct_cremation' | 'immediate_burial') =>
  itemsOf(x, c).filter((i) => !isOptionHeader(i));

// An option with nothing printed for its price, listed under a "Direct cremation" or "Immediate
// burial" line that has one price, reads as included at that price ("1. Cardboard box" under a
// priced Direct Cremation), in the spirit of decision 2026-10-20. Only a clear structure inherits:
// one unpriced option, numbered or bulleted, right under the priced line on the same page. A looser
// structure under a priced line is 'maybe_inherited' (review). A printed blank ("$____") never inherits.
export type OptionPrice = { state: PriceState | 'inherited' | 'maybe_inherited'; parent?: ExtractedItem };
const LIST_MARKER = /^\s*(?:\d{1,2}|[a-z])[.)]\s|^\s*[-•*]\s/i;

export function optionPrice(x: GplExtraction, o: ExtractedItem): OptionPrice {
  const state = priceState(o);
  if (state !== 'missing' || o.priceText !== null) return { state };
  const unpricedSibling = (i: ExtractedItem | undefined) => i?.category === o.category && !isPriced(i) && i.priceText === null;
  const at = x.items.indexOf(o);
  let start = at;
  while (unpricedSibling(x.items[start - 1])) start--;
  let end = at;
  while (unpricedSibling(x.items[end + 1])) end++;
  const parent = x.items[start - 1];
  if (!parent || parent.category !== o.category || parent.price === null || parent.priceRange !== null) return { state };
  const run = x.items.slice(start, end + 1);
  const clear = isOptionHeader(parent) && run.length === 1 && o.page === parent.page && LIST_MARKER.test(o.label);
  return { state: clear ? 'inherited' : 'maybe_inherited', parent };
}

// Decision 2026-10-20: a direct cremation price plus a separately priced alternative container passes C-041.
const SOLD_CONTAINER = /\b(alternative container|cremation container|fiberboard|cardboard|corrugated|composition|pressboard|unfinished wood|wood box)\b/;
export const separatelySoldContainers = (x: GplExtraction) =>
  x.items.filter((i) => {
    if (i.category !== 'other' && i.category !== 'direct_cremation') return false;
    if (i.category === 'direct_cremation' && isOptionHeader(i)) return false;
    const l = normalize(i.label);
    return isPriced(i) && SOLD_CONTAINER.test(l) && !/\b(burial container|outer)\b/.test(l) && !PURCHASER.test(l) && !/\bdirect cremation\b/.test(l);
  });

export function evaluateConditions(x: GplExtraction, m: Matches): Conditions {
  const offered = (c: ItemCategory) => itemsOf(x, c).length > 0;
  const caskets = itemsOf(x, 'caskets');
  const obc = itemsOf(x, 'outer_burial_containers');
  const selectionSentence = Object.values(m['D-selection'].conditional)[0] ?? 'absent';
  return {
    direct_cremation_offered: offered('direct_cremation'),
    immediate_burial_offered: offered('immediate_burial'),
    forwarding_offered: offered('forwarding'),
    receiving_offered: offered('receiving'),
    embalming_offered: offered('embalming'),
    // A separate basic services line at all (form C(1)); blank prices on it are C-070's finding.
    basic_services_priced: offered('basic_services'),
    basic_services_declared_nondeclinable:
      selectionSentence !== 'absent' || m['D-basic-nondeclinable'].status !== 'absent',
    caskets_as_range: caskets.some(hasRange),
    caskets_itemized: caskets.some((i) => i.price !== null && !hasRange(i)),
    obc_as_range: obc.some(hasRange),
    obc_itemized: obc.some((i) => i.price !== null && !hasRange(i)),
  };
}
