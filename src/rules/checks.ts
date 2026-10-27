import { REQUIRED_ITEM_IDS, type ExtractedItem, type GplExtraction, type RequiredItemId } from '../extraction';
import {
  classifyOption,
  isOptionHeader,
  isPriced,
  itemsOf,
  optionPrice,
  optionsOf,
  priceState,
  separatelySoldContainers,
  type Conditions,
  type Matches,
  type OptionClass,
} from './conditions';
import { descriptionOf, normalize, similarity } from './text';
import type { CompleteListMatch, DisclosureMatch, Evidence, Outcome, Ruleset } from './types';

export const DETERMINISTIC_CHECK_IDS = [
  'C-001', 'C-002', 'C-003', 'C-004', 'C-005', 'C-006', 'C-007',
  'C-010',
  'C-020', 'C-022', 'C-023', 'C-024',
  'C-030', 'C-033',
  'C-040', 'C-041', 'C-042', 'C-043', 'C-044',
  'C-050', 'C-051', 'C-052', 'C-053',
  'C-060', 'C-061',
  'C-070', 'C-071', 'C-072', 'C-073', 'C-074',
] as const;
export type DeterministicCheckId = (typeof DETERMINISTIC_CHECK_IDS)[number];

export type CheckContext = {
  x: GplExtraction;
  ruleset: Ruleset;
  matches: Matches;
  completeList: CompleteListMatch;
  cond: Conditions;
  auditDate: Date;
};

export type CheckFn = (ctx: CheckContext) => Outcome | Outcome[];

const NONE: Evidence = { quote: null, page: null };
const met = (reason: string, evidence: Evidence = NONE): Outcome => ({ result: 'met', reason, evidence });
const violation = (reason: string, evidence: Evidence = NONE): Outcome => ({ result: 'violation', reason, evidence });
const seenViolation = (reason: string, evidence: Evidence = NONE): Outcome => ({ result: 'violation', reason, evidence, seen: true });
const uncertain = (reason: string, evidence: Evidence = NONE): Outcome => ({ result: 'uncertain', reason, evidence });
const na = (reason: string): Outcome => ({ result: 'not_applicable', reason, evidence: NONE });

// A printed amount the extractor left unparsed ("Starting at $395", price null) is still a price;
// C-071 judges whether its wording is vague.
const showsOneAmount = (i: ExtractedItem) => (i.priceText?.match(/\$\s*\d/g) ?? []).length === 1;

const itemEvidence = (i: ExtractedItem): Evidence => ({
  quote: i.priceText ? `${i.label}: ${i.priceText}` : i.label,
  page: i.page,
  itemCategory: i.category,
});

function fromDisclosure(m: DisclosureMatch): Outcome {
  if (m.status === 'present') return met(m.reason, m.evidence);
  if (m.status === 'altered') return uncertain(m.reason, m.evidence);
  return violation(m.reason, m.evidence);
}

function headerField(value: string | null, what: string): Outcome {
  const v = value?.trim();
  return v ? met(`${what} found`, { quote: v, page: null }) : violation(`no ${what} found on the list`);
}

// The Rule wants an "includes" description; a missing one may be a dropped or page-split paragraph.
const INCLUDES_BLOCK = /^(our (services|charge|charges|price|fee)\b.{0,80}\binclude|includes?\b)/;
function includesCheck(ctx: CheckContext, category: RequiredItemId): Outcome {
  const items = itemsOf(ctx.x, category);
  for (const i of items) {
    const description = descriptionOf(i, ctx.ruleset);
    if (description) return met('a description of what the price includes was found', { quote: description, page: i.page, itemCategory: category });
  }
  const target = items.find((i) => isOptionHeader(i)) ?? items[0]!;
  const ev = itemEvidence(target);
  const idx = ctx.x.items.indexOf(target);
  const next = ctx.x.items[idx + 1];
  if (!next || next.page > target.page) {
    return uncertain('no description was extracted, but the item is the last one on its page, so its description may continue on the next page', ev);
  }
  if (ctx.x.disclosures.some((d) => INCLUDES_BLOCK.test(normalize(d.text)))) {
    return uncertain('no description was attached to the item, but a description paragraph was extracted elsewhere on the list', ev);
  }
  return violation('no description of what the price includes was found with this item', ev);
}

type OptionKind = 'direct_cremation' | 'immediate_burial';
const NOUN: Record<OptionKind, string> = { direct_cremation: 'direct cremation', immediate_burial: 'immediate burial' };

// C-040, C-041 and C-050: is there a priced option of the wanted class?
function optionCheck(ctx: CheckContext, kind: OptionKind, wanted: OptionClass, label: string, extraPass: ExtractedItem[] = []): Outcome {
  const opts = optionsOf(ctx.x, kind);
  const hits = opts.map((o) => ({ o, ...optionPrice(ctx.x, o) })).filter(({ o }) => classifyOption(o) === wanted);
  const priced = hits.find((h) => h.state === 'priced');
  if (priced) return met(`priced option found: ${priced.o.label}`, itemEvidence(priced.o));
  const inherited = hits.find((h) => h.state === 'inherited');
  if (inherited) return met(`option found under a priced line: ${inherited.o.label}, under ${inherited.parent!.label}`, itemEvidence(inherited.o));
  if (extraPass[0]) return met(`a ${NOUN[kind]} price plus a separately priced container: ${extraPass[0].label}`, itemEvidence(extraPass[0]));
  if (hits.length) {
    const ev = itemEvidence(hits[0]!.o);
    const maybe = hits.find((h) => h.state === 'maybe_inherited');
    if (maybe) return uncertain(`the option ${label} has no price of its own; it may be included in the price of ${maybe.parent!.label}`, itemEvidence(maybe.o));
    return hits.every((h) => h.state === 'missing')
      ? violation(`the option ${label} is listed without a price`, ev)
      : uncertain(`the option ${label} has price text that could not be read as a price`, ev);
  }
  const unknown = opts.find((o) => classifyOption(o) === 'unknown');
  if (unknown) return uncertain(`could not tell what container the option "${unknown.label}" includes`, itemEvidence(unknown));
  if (opts.length) {
    return violation(`none of the ${opts.length} ${NOUN[kind]} options is ${label}`, { quote: opts.map((o) => o.label).join('; '), page: opts[0]!.page, itemCategory: kind });
  }
  return uncertain(`no separate ${NOUN[kind]} options were extracted`);
}

function rangeCheck(ctx: CheckContext, kind: OptionKind): Outcome {
  const items = itemsOf(ctx.x, kind);
  const header = items.find((i) => i.priceRange !== null);
  if (!header) return violation(`no ${NOUN[kind]} price range was found`, items[0] ? itemEvidence(items[0]) : NONE);
  const prices = optionsOf(ctx.x, kind).flatMap((o) => (o.price !== null ? [o.price] : []));
  const ev = itemEvidence(header);
  if (!prices.length) return met('price range shown', ev);
  const [lo, hi] = header.priceRange!;
  return lo === Math.min(...prices) && hi === Math.max(...prices)
    ? met('price range matches the lowest and highest option prices', ev)
    : violation(`price range ${lo} to ${hi} does not match the option prices (${Math.min(...prices)} to ${Math.max(...prices)})`, ev);
}

function completeListOutcome(ctx: CheckContext, what: string): Outcome {
  const { present, altered, paraphrase, evidence } = ctx.completeList;
  const needed = Number(ctx.cond.caskets_as_range) + Number(ctx.cond.obc_as_range);
  if (present >= needed) return met(`${what} shown as a range with the complete-price-list statement`, evidence);
  if (present + altered + paraphrase === 0) return violation(`${what} shown as a range, but the statement that a complete price list will be provided was not found`);
  return uncertain(`found ${present} exact and ${altered + paraphrase} partial complete-price-list statements for ${needed} price ranges`, evidence);
}

const RANGE_CATEGORIES: readonly RequiredItemId[] = ['caskets', 'outer_burial_containers', 'direct_cremation', 'immediate_burial'];
const VAGUE = /\b(starting at|starts at|from|as low as|and up|minimum|or more|up to)\b|\+\s*$/i;
const ITEM_LABELS = (r: Ruleset) => Object.fromEntries(r.items.map((i) => [i.id, i.label])) as Record<string, string>;

export const CHECKS: Record<DeterministicCheckId, CheckFn> = {
  'C-001': ({ x, ruleset }) => {
    if (!x.caption?.trim()) return violation('no caption found');
    const ev = { quote: x.caption, page: null };
    if (normalize(x.caption).includes('general price list')) return met('caption found', ev);
    return similarity('general price list', x.caption) >= ruleset.text_matching.thresholds.altered
      ? uncertain('the caption looks close to "General Price List" but does not match it', ev)
      : seenViolation('the caption does not say "General Price List"', ev);
  },
  'C-002': ({ x }) => headerField(x.providerName, 'funeral home name'),
  'C-003': ({ x }) => headerField(x.address, 'address'),
  'C-004': ({ x }) => headerField(x.phone, 'phone number'),
  'C-005': ({ x }) => {
    const raw = x.effectiveDate?.raw.trim();
    if (!raw) return violation('no effective date found');
    const ev = { quote: raw, page: null };
    if (/\[[^\]\d]*\]|_{3,}/.test(raw)) return seenViolation('the effective date is an unfilled template blank', ev);
    if (!/\d/.test(raw)) return uncertain('effective date text was found but contains no date', ev);
    return met('effective date found', ev);
  },
  'C-006': (ctx) => {
    if ((CHECKS['C-005'](ctx) as Outcome).result !== 'met') return na('no effective date to read');
    const iso = ctx.x.effectiveDate!.iso;
    const ev = { quote: ctx.x.effectiveDate!.raw, page: null };
    return iso && parseIso(iso) ? met(`effective date read as ${iso}`, ev) : violation('the effective date could not be read as a calendar date', ev);
  },
  'C-007': (ctx) => {
    const date = ctx.x.effectiveDate?.iso ? parseIso(ctx.x.effectiveDate.iso) : null;
    if (!date || (CHECKS['C-005'](ctx) as Outcome).result !== 'met') return na('no readable effective date');
    const cutoff = new Date(ctx.auditDate);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
    const ev = { quote: ctx.x.effectiveDate!.raw, page: null };
    return date < cutoff
      ? violation(`effective date ${ctx.x.effectiveDate!.iso} is more than 12 months before ${ctx.auditDate.toISOString().slice(0, 10)}`, ev)
      : met('effective date is within the last 12 months', ev);
  },

  'C-010': ({ matches }) => fromDisclosure(matches['D-selection']),

  'C-020': (ctx) => (ctx.cond.basic_services_priced ? includesCheck(ctx, 'basic_services') : na('no separate basic services fee')),
  'C-022': ({ cond, matches }) => {
    if (!cond.basic_services_priced || !cond.basic_services_declared_nondeclinable) return na('the list does not say the basic services fee cannot be declined');
    const m = matches['D-basic-nondeclinable'];
    const sentence = Object.values(matches['D-selection'].conditional)[0];
    if (m.status === 'absent' && sentence !== 'present') {
      return uncertain('the only sign that the fee cannot be declined is a partly matching sentence', matches['D-selection'].evidence);
    }
    return fromDisclosure(m);
  },
  'C-023': ({ cond, matches }) => {
    if (!cond.basic_services_priced) return na('no separate basic services fee');
    const nondeclinable = matches['D-basic-nondeclinable'].status !== 'absent';
    const sentence = (Object.values(matches['D-selection'].conditional)[0] ?? 'absent') !== 'absent';
    if (nondeclinable && !sentence) return violation('the basic services fee statement is present, but the selection statement lacks its sentence about the fee', matches['D-basic-nondeclinable'].evidence);
    if (!nondeclinable && !sentence) return violation('neither statement about whether the basic services fee can be declined was found');
    return met('the two statements about the basic services fee agree', matches['D-selection'].evidence);
  },
  'C-024': ({ cond, matches }) => {
    if (cond.basic_services_priced || !(cond.caskets_as_range || cond.caskets_itemized)) return na('a separate basic services fee is shown, or no casket prices');
    const m = matches['D-basic-in-casket'];
    if (m.status === 'present' && /\d/.test(m.slots.amount?.text ?? '')) return met(`${m.reason}; fee amount stated`, m.evidence);
    return m.status === 'absent' ? violation(m.reason, m.evidence) : uncertain(m.status === 'present' ? 'statement found but no fee amount in it' : m.reason, m.evidence);
  },

  'C-030': ({ cond, matches }) => (cond.embalming_offered ? fromDisclosure(matches['D-embalming']) : na('embalming not listed')),
  'C-033': ({ matches }) => {
    const m = matches['D-embalming'];
    if (m.status === 'absent') return na('no embalming statement');
    return m.optional['Except in certain special cases,']
      ? met('includes "Except in certain special cases"', m.evidence)
      : violation('the embalming statement leaves out "Except in certain special cases"', m.evidence);
  },

  'C-040': (ctx) =>
    ctx.cond.direct_cremation_offered ? optionCheck(ctx, 'direct_cremation', 'purchaser', 'with a container provided by the purchaser') : na('direct cremation not listed'),
  'C-041': (ctx) =>
    ctx.cond.direct_cremation_offered
      ? optionCheck(ctx, 'direct_cremation', 'alt_container', 'with an alternative container', separatelySoldContainers(ctx.x))
      : na('direct cremation not listed'),
  'C-042': (ctx) => (ctx.cond.direct_cremation_offered ? includesCheck(ctx, 'direct_cremation') : na('direct cremation not listed')),
  'C-043': (ctx) => (ctx.cond.direct_cremation_offered ? rangeCheck(ctx, 'direct_cremation') : na('direct cremation not listed')),
  'C-044': ({ cond, matches }) => {
    if (!cond.direct_cremation_offered) return na('direct cremation not listed');
    const m = matches['D-alt-container'];
    if (m.status !== 'present') return fromDisclosure(m);
    const slot = m.slots.containers ?? { text: '', state: 'empty' };
    if (slot.state === 'filled') return met(`${m.reason}; containers named: ${slot.text}`, m.evidence);
    if (slot.state === 'marker') return seenViolation(`the statement is present but the containers are left as a template blank ("${slot.text}")`, m.evidence);
    return uncertain('the statement is present but no containers were found after it', m.evidence);
  },

  'C-050': (ctx) =>
    ctx.cond.immediate_burial_offered ? optionCheck(ctx, 'immediate_burial', 'purchaser', 'with a casket provided by the purchaser') : na('immediate burial not listed'),
  'C-051': (ctx) => {
    if (!ctx.cond.immediate_burial_offered) return na('immediate burial not listed');
    const opt = optionsOf(ctx.x, 'immediate_burial').find((o) => {
      const k = classifyOption(o);
      return (k === 'casket' || k === 'alt_container') && ['priced', 'inherited'].includes(optionPrice(ctx.x, o).state);
    });
    if (opt) return met(`priced option found: ${opt.label}`, itemEvidence(opt));
    const ref = itemsOf(ctx.x, 'immediate_burial').find((i) => /casket price list/.test(normalize(`${i.label} ${i.includesText ?? ''}`)));
    if (ref) return met('refers to the casket price list', itemEvidence(ref));
    return violation('no priced immediate burial option with a casket or container was found');
  },
  'C-052': (ctx) => (ctx.cond.immediate_burial_offered ? includesCheck(ctx, 'immediate_burial') : na('immediate burial not listed')),
  'C-053': (ctx) => (ctx.cond.immediate_burial_offered ? rangeCheck(ctx, 'immediate_burial') : na('immediate burial not listed')),

  'C-060': (ctx) => (ctx.cond.forwarding_offered ? includesCheck(ctx, 'forwarding') : na('forwarding not listed')),
  'C-061': (ctx) => (ctx.cond.receiving_offered ? includesCheck(ctx, 'receiving') : na('receiving not listed')),

  'C-070': ({ x, ruleset }) => {
    const labels = ITEM_LABELS(ruleset);
    const out: Outcome[] = [];
    for (const category of REQUIRED_ITEM_IDS) {
      const items = itemsOf(x, category);
      if (!items.length) continue;
      const rangeOk = RANGE_CATEGORIES.includes(category);
      if (items.some((i) => i.price !== null || (rangeOk && i.priceRange !== null) || showsOneAmount(i))) continue;
      const ev = { ...itemEvidence(items[0]!), itemCategory: category };
      if (items.some((i) => i.priceRange !== null)) {
        out.push(uncertain(`${labels[category]} shows a price range where the Rule expects a single price`, ev));
      } else if (items.every((i) => priceState(i) === 'missing')) {
        out.push(violation(`${labels[category]} is listed without a price`, ev));
      } else {
        out.push(uncertain(`${labels[category]} has price text that could not be read as a price`, ev));
      }
    }
    return out.length ? out : [met('every listed required item shows a price')];
  },
  'C-071': ({ x }) => {
    const out = x.items
      .filter((i) => i.category !== 'other' && !RANGE_CATEGORIES.includes(i.category) && VAGUE.test(i.priceText ?? ''))
      .map((i) => seenViolation(`price shown as "${i.priceText}"`, itemEvidence(i)));
    return out.length ? out : [met('no starting-at or open-ended prices on required items')];
  },
  'C-072': (ctx) => {
    const caskets = itemsOf(ctx.x, 'caskets');
    if (!caskets.length) return na('caskets not listed');
    if (ctx.cond.caskets_itemized) return met('individual casket prices shown', itemEvidence(caskets.find((i) => i.price !== null)!));
    if (ctx.cond.caskets_as_range) return completeListOutcome(ctx, 'casket prices');
    const { present, altered, paraphrase, evidence } = ctx.completeList;
    return present + altered + paraphrase > 0
      ? met('casket line carries the complete-price-list statement; its missing price is reported under C-070', evidence)
      : uncertain('caskets are listed without prices or a range, so the pricing form is unclear', itemEvidence(caskets[0]!));
  },
  'C-073': (ctx) => {
    const obc = itemsOf(ctx.x, 'outer_burial_containers');
    if (!obc.length) return na('outer burial containers not listed');
    const legal = ctx.matches['D-obc-legal'];
    const outcomes: Outcome[] = [];
    if (ctx.cond.obc_itemized) outcomes.push(fromDisclosure(legal));
    if (ctx.cond.obc_as_range) outcomes.push(completeListOutcome(ctx, 'outer burial container prices'));
    if (outcomes.length) {
      return outcomes.find((o) => o.result === 'met') ?? outcomes.find((o) => o.result === 'uncertain') ?? outcomes[0]!;
    }
    if (ctx.completeList.present + ctx.completeList.altered + ctx.completeList.paraphrase > 0 || legal.status !== 'absent') {
      return met('container line carries its statement; its missing price is reported under C-070', legal.status !== 'absent' ? legal.evidence : ctx.completeList.evidence);
    }
    return uncertain('outer burial containers are listed without prices or a range, so the pricing form is unclear', itemEvidence(obc[0]!));
  },
  'C-074': ({ matches }) => {
    const m = matches['D-obc-legal'];
    if (m.status === 'absent') return na('no outer burial container statement');
    return m.optional['In most areas of the country,']
      ? met('includes "In most areas of the country"', m.evidence)
      : violation('the container statement leaves out "In most areas of the country"', m.evidence);
  },
};

function parseIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : d;
}

