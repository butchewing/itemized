#!/usr/bin/env node
// How much does a fresh extraction of one list vary from run to run? Calls /dev/variance-extract on a
// local Worker started with DEV_ROUTES=1 and MODEL_PROVIDER set to the provider under test, n times,
// bypassing the extraction cache. Run the Worker yourself:
//   npx wrangler dev -c wrangler.production.jsonc --port 8791 --ip 127.0.0.1 --var MODEL_PROVIDER:open-weights --var DEV_ROUTES:1
//   node test/eval/extraction-variance.mjs --list syn-03 --provider open-weights --base http://127.0.0.1:8791 [--runs 5] [--cap 0.5]
// Inputs follow the eval: synthetic lists go to meta-api as the PDF (set a) and to open-weights as page
// images (set d). Corpus lists are page images and may only go to open-weights; the eval's upload guard decides.
// Output: raw runs in test/eval/variance/ (synthetic, public) or corpus/eval/variance/ (real, gitignored),
// plus summary.md there rebuilt from every run file in that folder.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { groundTruth, score } from '../eval-extraction.mjs';
import { assertUploadAllowed, CORPUS, CORPUS_PAGES, ROOT } from './sets.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const LIST = args.list;
const PROVIDER = args.provider;
const RUNS = Number(args.runs ?? 5);
const CAP = Number(args.cap ?? 0.5);
const BASE = args.base;
if (!LIST || !PROVIDER || !BASE) throw new Error('--list, --provider and --base are required');

const isCorpus = existsSync(join(CORPUS_PAGES, LIST));
const SYN_PAGES = join(ROOT, 'test/eval/pages', LIST);
const pngs = (dir) => readdirSync(dir).filter((f) => /^p\d+\.png$/.test(f)).sort().map((f) => join(dir, f));

const input = isCorpus
  ? { paths: pngs(join(CORPUS_PAGES, LIST)), mime: 'image/png' }
  : PROVIDER === 'meta-api'
    ? { paths: [join(ROOT, 'prep/synthetic/pdf', `${LIST}.pdf`)], mime: 'application/pdf' }
    : { paths: pngs(SYN_PAGES), mime: 'image/png' };
if (!input.paths.length || !input.paths.every(existsSync)) throw new Error(`no input files for ${LIST}`);

const OUT = join(isCorpus ? CORPUS : ROOT, isCorpus ? 'eval/variance' : 'test/eval/variance');

const running = (await (await fetch(`${BASE}/dev/provider`)).json()).provider;
assertUploadAllowed({ id: LIST, provider: PROVIDER, private: isCorpus }, input.paths, running);

const mode = (xs) => {
  const tally = new Map();
  for (const x of xs) tally.set(x, (tally.get(x) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
};

async function once() {
  const form = new FormData();
  form.set('provider', PROVIDER);
  for (const p of input.paths) form.append('file', new Blob([readFileSync(p)], { type: input.mime }), p.split('/').at(-1));
  const res = await fetch(`${BASE}/dev/variance-extract`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) return { error: `${res.status} ${body.error}`, cost: body.cost ?? { usd: 0, ms: 0 } };
  return body;
}

mkdirSync(OUT, { recursive: true });
const runs = [];
let spent = 0;
for (let i = 0; i < RUNS; i++) {
  if (spent >= CAP) {
    console.log(`cap $${CAP} reached after ${runs.length} runs`);
    break;
  }
  const r = await once();
  spent += r.cost.usd;
  if (r.error) {
    runs.push({ error: r.error, costUsd: r.cost.usd, ms: r.cost.ms });
    console.log(`run ${i + 1} failed: ${r.error}`);
    continue;
  }
  const row = {
    costUsd: r.cost.usd,
    ms: r.cost.ms,
    disclosureBlocks: r.extraction.disclosures.length,
    taggedBlocks: r.extraction.disclosures.filter((d) => d.id !== 'unknown').length,
    items: r.extraction.items.length,
    matches: r.disclosures,
    verdicts: r.verdicts,
    extraction: r.extraction,
  };
  if (!isCorpus) {
    const s = score(LIST, groundTruth(LIST, null), r.extraction);
    Object.assign(row, { fields: s.fields, disc: s.disc, misses: s.misses.filter(Boolean) });
  }
  runs.push(row);
  console.log(`run ${i + 1}: blocks ${row.disclosureBlocks} items ${row.items} $${row.costUsd.toFixed(4)} ${row.ms} ms${row.fields ? ` fields ${row.fields.right}/${row.fields.total}` : ''}`);
}

writeFileSync(join(OUT, `${LIST}-${PROVIDER}.json`), `${JSON.stringify({ list: LIST, provider: PROVIDER, input: input.mime === 'application/pdf' ? 'pdf' : 'images', runs }, null, 1)}\n`);

// Agreement per check: how many runs returned the most common verdict for it.
function agreement(ok, pick) {
  const ids = Object.keys(pick(ok[0]));
  return ids.map((id) => {
    const [top, n] = mode(ok.map((r) => pick(r)[id]));
    const tally = Object.entries(Object.groupBy(ok, (r) => pick(r)[id])).map(([v, rs]) => `${v}x${rs.length}`).join(' ');
    return { id, top, n, tally };
  });
}

const sets = readdirSync(OUT).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')));
const md = ['# Extraction variance', '', `Rebuilt by test/eval/extraction-variance.mjs from every run file in this folder.`, ''];
for (const set of sets) {
  const ok = set.runs.filter((r) => !r.error);
  md.push(`## ${set.list} on ${set.provider} (${set.input}), ${ok.length} of ${set.runs.length} runs ok`, '');
  if (!ok.length) continue;
  const spread = (xs) => `${Math.min(...xs)} to ${Math.max(...xs)}`;
  md.push(`Spend $${set.runs.reduce((n, r) => n + r.costUsd, 0).toFixed(4)}. Disclosure blocks per run: ${ok.map((r) => r.disclosureBlocks).join(', ')} (spread ${spread(ok.map((r) => r.disclosureBlocks))}). Tagged with a known id: ${ok.map((r) => r.taggedBlocks).join(', ')}. Items: ${ok.map((r) => r.items).join(', ')}.`);
  if (ok[0].fields) md.push(`Fields right: ${ok.map((r) => `${r.fields.right}/${r.fields.total}`).join(', ')}. Disclosures right: ${ok.map((r) => `${r.disc.right}/${r.disc.total}`).join(', ')}.`);
  md.push('', '| Disclosure | Statuses across runs |', '|---|---|');
  const rows = agreement(ok, (r) => Object.fromEntries(Object.entries(r.matches).map(([id, m]) => [id, m.status])));
  for (const a of rows) md.push(`| ${a.id} | ${a.tally} |`);
  for (const m of ['images', 'pdf']) {
    const a = agreement(ok, (r) => r.verdicts[m]);
    const unanimous = a.filter((x) => x.n === ok.length).length;
    const changed = a.reduce((n, x) => n + (ok.length - x.n), 0);
    md.push('', `Verdicts under the ${m} rules: ${unanimous} of ${a.length} checks unanimous, ${changed} run-verdicts differ from the majority (of ${a.length * ok.length}).`);
    const split = a.filter((x) => x.n < ok.length);
    if (split.length) md.push('', '| Check | Verdicts | Majority share |', '|---|---|---|', ...split.map((x) => `| ${x.id} | ${x.tally} | ${x.n}/${ok.length} |`));
  }
  md.push('');
}
writeFileSync(join(OUT, 'summary.md'), `${md.join('\n')}\n`);
console.log(`spent $${spent.toFixed(4)}; wrote ${join(OUT, 'summary.md').replace(ROOT + '/', '')}`);
