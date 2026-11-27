import txRuleset from '../../prep/rules/tx-651@2026.1.json';
import type { ExtractedItem, GplExtraction } from '../extraction';
import { isPriced, priceTextIsMissing, type Matches } from './conditions';
import { align, normalize, type Corpus } from './text';
import type { Evidence, Outcome } from './types';

// Texas checks (prep/rules/tx-651@2026.1.json): only what Texas adds to the federal checks.
// Sources and decisions: prep/rules/tx-tfsc-sources.md.
export type TexasRuleset = typeof txRuleset;
export type TexasCheck = TexasRuleset['checks'][number];
export type TexasCheckId = TexasCheck['id'];
export const TX_RULESET = txRuleset;

type Ctx = { x: GplExtraction; corpus: Corpus; matches: Matches; thresholds: { match: number; altered: number } };

const NONE: Evidence = { quote: null, page: null };
const met = (reason: string, evidence: Evidence = NONE): Outcome => ({ result: 'met', reason, evidence });
const violation = (reason: string, evidence: Evidence, seen = false): Outcome => ({ result: 'violation', reason, evidence, ...(seen && { seen: true as const }) });
const uncertain = (reason: string, evidence: Evidence = NONE): Outcome => ({ result: 'uncertain', reason, evidence });
const na = (reason: string): Outcome => ({ result: 'not_applicable', reason, evidence: NONE });
const itemEvidence = (i: ExtractedItem): Evidence => ({ quote: i.priceText ? `${i.label}: ${i.priceText}` : i.label, page: i.page, itemCategory: i.category });

// A Texas address: "TX" or "Texas" in the address line, or a Texas ZIP code (75000-79999, 885xx) ending it.
export function isTexas(x: GplExtraction): boolean {
  const a = x.address ?? '';
  return /\b(TX|Tex\.?|Texas)\b/.test(a) || /\b(7[5-9]\d{3}|885\d{2})(-\d{4})?\s*$/.test(a.trim());
}

// Every piece of the list's own words the extraction keeps: notices, item labels and descriptions,
// caption and provider name.
const allText = (x: GplExtraction) =>
  normalize([x.caption, x.providerName, ...x.disclosures.map((d) => d.text), ...x.items.flatMap((i) => [i.label, i.includesText])].filter(Boolean).join(' \n '));

// An item for filing or processing a life insurance claim on the family's behalf.
const INSURANCE_ITEM = /\binsurance\b/i;
const CLAIM_SERVICE = /\b(claim|claims|filing|file|process|processing|assignment)\b/i;
const insuranceItems = (x: GplExtraction) => x.items.filter((i) => INSURANCE_ITEM.test(i.label) && CLAIM_SERVICE.test(i.label));
const NO_CHARGE = /\b(no charge|free|included|n\/c|complimentary|\$\s*0(\.00)?)\b/i;

// The list says the provider runs its own crematory (not a third-party crematory fee).
const OWN_CREMATORY =
  /\b(our|on site|onsite|own|in house|private) (crematory|crematorium)\b|\b(crematory|crematorium) (is )?(owned|operated|located) (by|on|at)\b|\blicensed crematory\b/;

// A selection notice ends "...describing the [funeral] goods and services you selected"; the crematory
// version (Occupations Code §651.4055(c)) drops "funeral" and the basic-services sentence.
function selectionNotices(c: Corpus) {
  const found: { crematoryForm: boolean; evidence: Evidence }[] = [];
  for (const b of c.blocks) {
    if (!b.norm.includes('you may choose only the items you desire')) continue;
    const tail = /describing the (funeral )?goods and services you selected/.exec(b.norm);
    const basic = /will include a charge for our basic services/.test(b.norm);
    found.push({ crematoryForm: !!tail && !tail[1] && !basic, evidence: { quote: b.orig, page: b.page } });
  }
  return found;
}


export const TEXAS_CHECKS: Record<TexasCheckId, (ctx: Ctx) => Outcome> = {
  'TX-001': ({ x }) => {
    const items = insuranceItems(x);
    if (!items.length) return na('the list does not offer filing life insurance claims');
    for (const i of items) {
      if (isPriced(i) || NO_CHARGE.test(`${i.priceText ?? ''} ${i.includesText ?? ''}`)) continue;
      // No price text at all may mean no charge (the fee is required only "if the funeral home charges");
      // a printed blank or "call for price" is a price left out.
      if (i.priceText === null) return uncertain('insurance claim filing is listed with no price and no word on whether it is free', itemEvidence(i));
      if (priceTextIsMissing(i.priceText)) return violation('insurance claim filing is listed with no price', itemEvidence(i), true);
      return uncertain('insurance claim filing is listed but its price could not be read', itemEvidence(i));
    }
    return met('insurance claim filing shows a price or says there is no charge', itemEvidence(items[0]!));
  },

  'TX-002': ({ matches }) => {
    const m = matches['D-selection'];
    // Only a notice the federal check accepts: a missing or reworded one is already reported there.
    if (m.status !== 'present') return na('the federal check reports the selection notice');
    const sentence = Object.values(m.conditional)[0] ?? 'absent';
    const overhead = Object.entries(m.optional).some(([k, v]) => /overhead/.test(k) && v);
    if (sentence === 'present' && overhead) return met('the notice includes the sentence about basic services and overhead', m.evidence);
    const missing = sentence === 'present' ? 'says "basic services" without "and overhead"' : 'leaves out the sentence about a charge for basic services and overhead';
    return violation(`the notice ${missing}; Texas law (Occupations Code §651.405(b)) prints that sentence, while the Funeral Service Commission's rule (22 TAC §203.49) lets it be shortened or omitted`, m.evidence);
  },

  'TX-003': ({ x, corpus }) => {
    if (!OWN_CREMATORY.test(allText(x)) && !/\b(crematory|crematorium)\b/i.test(x.providerName ?? '')) {
      return na('the list does not say the provider operates a crematory');
    }
    const notices = selectionNotices(corpus);
    const crematory = notices.find((n) => n.crematoryForm);
    if (crematory) return met('the crematory notice is on the list', crematory.evidence);
    return violation('the list says the provider operates a crematory, but the crematory notice (without the basic-services sentence) is not on it', notices[0]?.evidence ?? NONE);
  },

  'TX-004': ({ x, corpus, thresholds }) => {
    if (insuranceItems(x).length) return na('the list offers filing life insurance claims itself');
    if (!/\binsurance\b/.test(allText(x))) return na('the list does not mention paying with life insurance');
    const w = align(normalize(TX_RULESET.notices['N-tx-third-party-insurance'].t), corpus.text);
    if (w.score >= thresholds.match) return met('the statement about third-party claim filing fees is on the list');
    return violation('the list mentions insurance and does not offer claim filing, and the statement about third-party claim filing fees is not on it; it is required only if payment is due before insurance pays out', NONE);
  },

};

export type TexasOutcome = { check: TexasCheck; outcome: Outcome };

// Runs only for a Texas provider; elsewhere there is nothing to report.
export function runTexasChecks(x: GplExtraction, corpus: Corpus, matches: Matches, thresholds: Ctx['thresholds']): TexasOutcome[] {
  if (!isTexas(x)) return [];
  const ctx: Ctx = { x, corpus, matches, thresholds };
  return TX_RULESET.checks.map((check) => ({ check, outcome: TEXAS_CHECKS[check.id](ctx) }));
}
