import ruleset from '../prep/rules/ftc-453@2026.1.json';

// Bump on any change to the prompt or schema: it is part of the extraction cache key.
export const PROMPT_VERSION = 'extract-1';

export const REQUIRED_ITEM_IDS = [
  'forwarding',
  'receiving',
  'direct_cremation',
  'immediate_burial',
  'transfer',
  'embalming',
  'other_prep',
  'viewing',
  'funeral_ceremony',
  'memorial_service',
  'graveside',
  'hearse',
  'limousine',
  'caskets',
  'outer_burial_containers',
  'basic_services',
] as const;
export type RequiredItemId = (typeof REQUIRED_ITEM_IDS)[number];
export type ItemCategory = RequiredItemId | 'other';

export type DisclosureId = keyof typeof ruleset.disclosures;
export const DISCLOSURE_IDS = Object.keys(ruleset.disclosures) as DisclosureId[];

export type ExtractedDisclosure = { id: DisclosureId | 'unknown'; text: string; page: number };

export type ExtractedItem = {
  category: ItemCategory;
  label: string;
  price: number | null;
  priceRange: [number, number] | null;
  priceText: string | null;
  includesText: string | null;
  page: number;
};

export type GplExtraction = {
  caption: string | null;
  providerName: string | null;
  address: string | null;
  phone: string | null;
  effectiveDate: { raw: string; iso: string | null } | null;
  disclosures: ExtractedDisclosure[];
  items: ExtractedItem[];
};

const nullable = (type: string) => ({ type: [type, 'null'] });

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['caption', 'providerName', 'address', 'phone', 'effectiveDate', 'disclosures', 'items'],
  properties: {
    caption: nullable('string'),
    providerName: nullable('string'),
    address: nullable('string'),
    phone: nullable('string'),
    effectiveDate: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['raw', 'iso'],
      properties: { raw: { type: 'string' }, iso: nullable('string') },
    },
    disclosures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'page'],
        properties: {
          id: { type: 'string', enum: [...DISCLOSURE_IDS, 'unknown'] },
          text: { type: 'string' },
          page: { type: 'integer' },
        },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'label', 'price', 'priceRange', 'priceText', 'includesText', 'page'],
        properties: {
          category: { type: 'string', enum: [...REQUIRED_ITEM_IDS, 'other'] },
          label: { type: 'string' },
          price: nullable('number'),
          priceRange: { type: ['array', 'null'], items: { type: 'number' }, minItems: 2, maxItems: 2 },
          priceText: nullable('string'),
          includesText: nullable('string'),
          page: { type: 'integer' },
        },
      },
    },
  },
} as const;

const disclosureGuide = DISCLOSURE_IDS.map((id) => {
  const d = ruleset.disclosures[id];
  const opening = d.segments.find((s) => s.kind === 'fixed' && 't' in s)?.t?.slice(0, 90);
  return `- ${id}: ${d.title}. Typically begins "${opening}"`;
}).join('\n');

const itemGuide = ruleset.items.map((i) => `- ${i.id}: ${i.label}`).join('\n');

export const SYSTEM_PROMPT = `You transcribe funeral home General Price Lists (GPLs) into JSON. You are a transcriber, not an auditor.

Rules:
- Copy text exactly as printed, including odd spelling, capitalization and punctuation. Never paraphrase, complete, correct or infer text. If something is not printed, use null (or omit the array entry). Never fill in what a compliant list would say.
- Prices exactly as printed. "price" is a single dollar amount as a number. For a range such as "$995 to $11,950", set price to null and priceRange to [995, 11950]. For "Call for pricing", "Varies" or similar, both are null. "priceText" is the price string verbatim as printed, or null when no price text is printed.
- "caption" is the document title as printed (for example "General Price List"), even if it is wrong. "effectiveDate.raw" is the effective-date text as printed; "iso" is YYYY-MM-DD or null if it cannot be read as a full date.
- "address" is the street address lines joined with ", ". "phone" is the provider telephone as printed.
- "items" has one entry per priced or named line item, in document order, including sub-options (such as "A. Direct cremation with container provided by the purchaser") and other merchandise. Sub-options use the category of the item they belong to. Items not matching a required category use "other". "includesText" is the verbatim "Our services include..." or "Our charge includes..." paragraph attached to the item, else null.
- Required item categories:
${itemGuide}
- "disclosures" has one entry per block of explanatory or notice text on the list (not item descriptions). "text" is the full block verbatim. Set "id" to the disclosure it most closely corresponds to when its meaning matches, otherwise "unknown". Even if the wording differs from the typical wording, still transcribe it verbatim. Known disclosures:
${disclosureGuide}
- "page" is the 1-based page of the document where the entry appears. A single photo is page 1.
- The document may be a photo: rotated, angled or partly cropped. Read each price with its own row. If text is unreadable, leave it out rather than guess.`;

export class ExtractionError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new ExtractionError(`${path}: expected string`);
  return v;
}
const strOrNull = (v: unknown, path: string) => (v === null ? null : str(v, path));
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ExtractionError(`${path}: expected number`);
  return v;
}
const numOrNull = (v: unknown, path: string) => (v === null ? null : num(v, path));
function page(v: unknown, path: string): number {
  const n = num(v, path);
  if (!Number.isInteger(n) || n < 1) throw new ExtractionError(`${path}: expected page >= 1`);
  return n;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ExtractionError(`${path}: expected array`);
  return v;
}
function obj(v: unknown, path: string): Record<string, unknown> {
  if (!isObj(v)) throw new ExtractionError(`${path}: expected object`);
  return v;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ExtractionError(`${path}: unexpected value`);
  }
  return v as T;
}

export function parseExtraction(json: unknown): GplExtraction {
  const o = obj(json, '$');
  const date = o.effectiveDate === null ? null : obj(o.effectiveDate, 'effectiveDate');
  return {
    caption: strOrNull(o.caption, 'caption'),
    providerName: strOrNull(o.providerName, 'providerName'),
    address: strOrNull(o.address, 'address'),
    phone: strOrNull(o.phone, 'phone'),
    effectiveDate: date && { raw: str(date.raw, 'effectiveDate.raw'), iso: strOrNull(date.iso, 'effectiveDate.iso') },
    disclosures: arr(o.disclosures, 'disclosures').map((raw, i) => {
      const d = obj(raw, `disclosures[${i}]`);
      return {
        id: oneOf(d.id, [...DISCLOSURE_IDS, 'unknown'], `disclosures[${i}].id`),
        text: str(d.text, `disclosures[${i}].text`),
        page: page(d.page, `disclosures[${i}].page`),
      };
    }),
    items: arr(o.items, 'items').map((raw, i) => {
      const it = obj(raw, `items[${i}]`);
      const range = it.priceRange === null ? null : arr(it.priceRange, `items[${i}].priceRange`);
      if (range && range.length !== 2) throw new ExtractionError(`items[${i}].priceRange: expected 2 numbers`);
      return {
        category: oneOf(it.category, [...REQUIRED_ITEM_IDS, 'other'], `items[${i}].category`),
        label: str(it.label, `items[${i}].label`),
        price: numOrNull(it.price, `items[${i}].price`),
        priceRange: range && [num(range[0], `items[${i}].priceRange[0]`), num(range[1], `items[${i}].priceRange[1]`)],
        priceText: strOrNull(it.priceText, `items[${i}].priceText`),
        includesText: strOrNull(it.includesText, `items[${i}].includesText`),
        page: page(it.page, `items[${i}].page`),
      };
    }),
  };
}
