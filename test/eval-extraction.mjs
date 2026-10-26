#!/usr/bin/env node
// Posts the synthetic PDFs and photos to a local Worker and scores each stored extraction
// against ground truth parsed from prep/synthetic/html.
//   node test/eval-extraction.mjs [--base URL] [--set pdf|photos|pairs|all] [--gap ms] [--only file] [--out file.json]
//     [--images-dir dir]  read the photos' bytes from dir (same filenames as the manifest), e.g. cropped copies
// --set pairs uploads each list's photos together as one multi-page document, scores it against the
// whole list, runs its PDF too, and reports any fail on the photos that the PDF does not have.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYN = join(ROOT, 'prep/synthetic');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.base ?? 'http://localhost:8787';
const SET = args.set ?? 'all';
const GAP_MS = Number(args.gap ?? 13000);
const POLL_TIMEOUT_MS = 240000;
const PHOTOS_DIR = args['images-dir'] ?? join(SYN, 'photos');

const ruleset = JSON.parse(readFileSync(join(ROOT, 'prep/rules/ftc-453@2026.1.json'), 'utf8'));
const DISCLOSURE_IDS = Object.keys(ruleset.disclosures);

// First priced line on photo page 2, read off the photos by eye. `orphanIncludes`: the previous
// item's "includes" paragraph spills onto page 2 while its label and price stay on page 1.
const PAGE2_STARTS_AT = {
  'syn-01': { label: 'Receiving Remains', orphanIncludes: true },
  'syn-03': { label: 'Direct Cremation', orphanIncludes: true },
  'syn-09': { label: 'Receiving Remains', orphanIncludes: false },
  'syn-10': { label: 'Forwarding of Remains', orphanIncludes: false },
};

const KEY_PHRASES = {
  'D-selection': 'you may choose only the items you desire',
  'D-basic-nondeclinable': 'this fee for our basic services',
  'D-basic-in-casket': 'is included in the price of our caskets',
  'D-embalming': 'embalming is not required by law',
  'D-alt-container': 'you can use an alternative container',
  'D-obc-legal': 'state or local law does not require that you buy a container to surround the casket',
};
const COMPLETE_LIST = 'a complete price list will be provided at the funeral home';

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");
const text = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const norm = (s) => (s ?? '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9$]+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));
const jaccard = (a, b) => {
  const A = tokens(a), B = tokens(b);
  const inter = [...A].filter((t) => B.has(t)).length;
  return A.size + B.size === 0 ? 1 : inter / (A.size + B.size - inter);
};

const CATEGORY_BY_LABEL = [
  ['basic_services', /^basic services/i], ['embalming', /^embalming/i], ['other_prep', /^other preparation/i],
  ['transfer', /^transfer of remains/i], ['viewing', /for viewing/i], ['funeral_ceremony', /funeral ceremony/i],
  ['memorial_service', /memorial service/i], ['graveside', /graveside/i], ['hearse', /^hearse/i],
  ['limousine', /^limousine/i], ['caskets', /^caskets?$/i], ['outer_burial_containers', /^outer burial container/i],
  ['forwarding', /^forwarding/i], ['receiving', /^receiving/i], ['direct_cremation', /^direct cremation/i],
  ['immediate_burial', /^immediate burial/i],
];
const INHERITING = new Set(['other_prep', 'direct_cremation', 'immediate_burial', 'caskets', 'outer_burial_containers']);

function parsePrice(priceText) {
  if (priceText === null) return { price: null, priceRange: null };
  const nums = [...priceText.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  if (nums.length === 2 && /\bto\b|-|–/.test(priceText)) return { price: null, priceRange: nums };
  if (nums.length === 1) return { price: nums[0], priceRange: null };
  return { price: null, priceRange: null };
}

// Ground truth for one list, optionally cut to one photo page.
function groundTruth(listId, photoPage) {
  const html = readFileSync(join(SYN, 'html', `${listId}.html`), 'utf8');
  const body = html.slice(html.indexOf('<body>'));
  const header = body.match(/<header>([\s\S]*?)<\/header>/)[1];
  const divs = [...header.matchAll(/<div(?: class="(\w+)")?>([\s\S]*?)<\/div>/g)].map((m) => ({ cls: m[1], t: text(m[2]) }));
  const plain = divs.filter((d) => !d.cls);
  const phone = plain.find((d) => /^\(\d{3}\) \d{3}-\d{4}$/.test(d.t))?.t ?? null;
  const address = plain.filter((d) => d.t !== phone).map((d) => d.t);
  const eff = divs.find((d) => d.cls === 'eff')?.t ?? null;
  const dateMatch = eff?.match(/([A-Z][a-z]+ \d{1,2}, \d{4})/);
  const iso = dateMatch ? new Date(`${dateMatch[1]} UTC`).toISOString().slice(0, 10) : null;
  const h1 = header.match(/<h1>([\s\S]*?)<\/h1>/);
  const onPage1 = !photoPage || photoPage === 1;

  const header_ = onPage1
    ? { caption: text(header.match(/<h2>([\s\S]*?)<\/h2>/)[1]), providerName: h1 ? text(h1[1]) : null, address: address.length ? address.join(' ') : null, phone, effectiveText: dateMatch?.[1] ?? null, effectiveIso: iso }
    : { caption: null, providerName: null, address: null, phone: null, effectiveText: null, effectiveIso: null };

  const items = [];
  const disclosures = new Set();
  let page = 1;
  let merch = false;
  let parent = null;
  let lastLn = null;
  const elems = [...body.slice(body.indexOf('</header>')).matchAll(/<(div class="ln(?: ind)?"|p class="(?:inc|disc|sub)"|h3)>([\s\S]*?)<\/(?:div|p|h3)>(?=\s*(?:<|$))/g)];
  for (const m of elems) {
    const tag = m[1];
    if (tag.startsWith('div class="ln')) {
      const label = text(m[2].match(/<span class="lb">([\s\S]*?)<\/span>/)[1]);
      const pr = m[2].match(/<span class="pr">([\s\S]*?)<\/span>/);
      const indented = tag.includes('ind');
      const split = PAGE2_STARTS_AT[listId];
      if (split && page === 1 && label.startsWith(split.label)) {
        page = 2;
        if (split.orphanIncludes && photoPage === 1 && items.length) items[items.length - 1].includes = null;
      }
      lastLn = label;
      let category;
      if (merch) category = 'other';
      else if (indented) category = parent && INHERITING.has(parent) ? parent : undefined;
      else category = CATEGORY_BY_LABEL.find(([, re]) => re.test(label))?.[0];
      if (!indented) parent = category ?? null;
      if (pr && (!photoPage || page === photoPage)) {
        items.push({ label, priceText: text(pr[1]), category, includes: null });
      }
    } else if (tag === 'h3') merch = true;
    else if (tag.includes('inc')) {
      const last = items.at(-1);
      if (last && !last.includes && (!photoPage || page === photoPage)) last.includes = text(m[2]);
    } else if (tag.includes('disc') && (!photoPage || page === photoPage)) {
      const t = norm(text(m[2]));
      for (const [id, phrase] of Object.entries(KEY_PHRASES)) if (t.includes(phrase)) disclosures.add(id);
      if (t.includes(COMPLETE_LIST)) {
        if (/^caskets/i.test(lastLn ?? '')) disclosures.add('D-casket-list');
        else if (/^outer burial/i.test(lastLn ?? '')) disclosures.add('D-obc-list');
      }
    }
  }
  return { header: header_, items, disclosures, sourceText: norm(text(body)) };
}

// Lists whose disclosure is deliberately reworded, so phrase-based truth reads it as absent.
const PARAPHRASED = { 'syn-11': ['D-selection'] };

function score(listId, truth, got) {
  const fields = { right: 0, total: 0 };
  const misses = [];
  const check = (ok, what) => {
    fields.total++;
    if (ok) fields.right++;
    else misses.push(what);
  };
  const h = truth.header;
  const same = (a, b) => (a === null || b === null ? a === b : norm(a) === norm(b));
  check(same(h.caption, got.caption), `caption: want ${JSON.stringify(h.caption)} got ${JSON.stringify(got.caption)}`);
  check(same(h.providerName, got.providerName), `providerName: want ${JSON.stringify(h.providerName)} got ${JSON.stringify(got.providerName)}`);
  check(same(h.address, got.address), `address: want ${JSON.stringify(h.address)} got ${JSON.stringify(got.address)}`);
  check(same(h.phone, got.phone), `phone: want ${JSON.stringify(h.phone)} got ${JSON.stringify(got.phone)}`);
  const raw = got.effectiveDate?.raw ?? null;
  check(h.effectiveText === null ? raw === null : raw !== null && norm(raw).includes(norm(h.effectiveText)), `effectiveDate.raw: want ${JSON.stringify(h.effectiveText)} got ${JSON.stringify(raw)}`);
  check((got.effectiveDate?.iso ?? null) === h.effectiveIso, `effectiveDate.iso: want ${h.effectiveIso} got ${got.effectiveDate?.iso ?? null}`);

  const pool = got.items.map((it, i) => ({ it, i, used: false }));
  for (const exp of truth.items) {
    let best = null, bestScore = 0;
    for (const c of pool) {
      if (c.used) continue;
      const s = jaccard(exp.label.replace(/^[A-C]\.\s*/, ''), c.it.label.replace(/^[A-C]\.\s*/, ''));
      if (s > bestScore) [best, bestScore] = [c, s];
    }
    if (!best || bestScore < 0.6) {
      for (let k = 0; k < 2 + Number(Boolean(exp.category)) + Number(Boolean(exp.includes)); k++) check(false, '');
      misses.push(`item missing: ${exp.label} [${exp.priceText}]`);
      continue;
    }
    best.used = true;
    const g = best.it;
    const want = parsePrice(exp.priceText);
    const priceOk = want.priceRange
      ? g.priceRange?.[0] === want.priceRange[0] && g.priceRange?.[1] === want.priceRange[1] && g.price === null
      : g.price === want.price && g.priceRange === null;
    check(priceOk, `price ${exp.label}: want ${exp.priceText} got price=${g.price} range=${JSON.stringify(g.priceRange)}`);
    check(g.priceText !== null && norm(g.priceText) === norm(exp.priceText), `priceText ${exp.label}: want ${JSON.stringify(exp.priceText)} got ${JSON.stringify(g.priceText)}`);
    if (exp.category) check(g.category === exp.category, `category ${exp.label}: want ${exp.category} got ${g.category}`);
    if (exp.includes) check(g.includesText !== null && jaccard(exp.includes, g.includesText) >= 0.8, `includesText ${exp.label}: ${g.includesText === null ? 'null' : 'differs'}`);
  }
  const extra = pool.filter((c) => !c.used && (c.it.price !== null || c.it.priceRange !== null));
  for (const c of extra) misses.push(`extra priced item: ${c.it.label} [${c.it.priceText}]`);

  const gotIds = new Set(got.disclosures.map((d) => d.id));
  const disc = { right: 0, total: DISCLOSURE_IDS.length };
  for (const id of DISCLOSURE_IDS) {
    const want = truth.disclosures.has(id);
    if (want === gotIds.has(id)) disc.right++;
    else misses.push(`disclosure ${id}: want ${want ? 'present' : 'absent'}${PARAPHRASED[listId]?.includes(id) ? ' (source is a paraphrase; not an extraction fault if labelled by meaning)' : ''}`);
  }
  const verbatim = got.disclosures.filter((d) => truth.sourceText.includes(norm(d.text)));
  const verbatimMiss = got.disclosures.filter((d) => !truth.sourceText.includes(norm(d.text)));
  for (const d of verbatimMiss) misses.push(`disclosure text not verbatim (${d.id}): ${d.text.slice(0, 90)}`);
  return { fields, disc, verbatim: { right: verbatim.length, total: got.disclosures.length }, extra: extra.length, misses };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(paths, mime) {
  const name = paths.map((p) => p.split('/').at(-1)).join('+');
  for (;;) {
    const form = new FormData();
    for (const p of paths) form.append('file', new Blob([readFileSync(p)], { type: mime }), p.split('/').at(-1));
    const res = await fetch(`${BASE}/api/audits`, { method: 'POST', body: form });
    if (res.status === 429) {
      await sleep(15000);
      continue;
    }
    if (!res.ok) throw new Error(`upload ${name}: ${res.status} ${await res.text()}`);
    return (await res.json()).id;
  }
}

async function poll(id) {
  const t0 = Date.now();
  while (Date.now() - t0 < POLL_TIMEOUT_MS) {
    const a = await (await fetch(`${BASE}/api/audits/${id}`)).json();
    if (a.status === 'done' || a.status === 'failed') return a;
    await sleep(1500);
  }
  throw new Error(`audit ${id} timed out`);
}

function documents() {
  const docs = [];
  if (SET === 'pdf' || SET === 'all') {
    for (const f of readdirSync(join(SYN, 'pdf')).filter((f) => f.endsWith('.pdf')).sort()) {
      docs.push({ file: f, paths: [join(SYN, 'pdf', f)], mime: 'application/pdf', list: f.replace('.pdf', ''), page: null });
    }
  }
  if (SET === 'photos' || SET === 'all') {
    const manifest = JSON.parse(readFileSync(join(SYN, 'photos/manifest.json'), 'utf8'));
    for (const p of manifest.photos) docs.push({ file: p.file, paths: [join(PHOTOS_DIR, p.file)], mime: 'image/jpeg', list: p.list, page: p.page });
  }
  if (SET === 'pairs') {
    const manifest = JSON.parse(readFileSync(join(SYN, 'photos/manifest.json'), 'utf8'));
    for (const list of [...new Set(manifest.photos.map((p) => p.list))]) {
      const pages = manifest.photos.filter((p) => p.list === list).sort((a, b) => a.page - b.page);
      docs.push({ file: `${list}.pdf`, paths: [join(SYN, 'pdf', `${list}.pdf`)], mime: 'application/pdf', list, page: null });
      docs.push({ file: `${list} photos`, paths: pages.map((p) => join(PHOTOS_DIR, p.file)), mime: 'image/jpeg', list, page: null, pair: true });
    }
  }
  return args.only ? docs.filter((d) => d.file === args.only) : docs;
}

const fmtRatio = (r) => `${r.right}/${r.total}`;
const usd = (n) => `$${n.toFixed(4)}`;

async function main() {
  const rows = [];
  const docs = documents();
  for (const [i, d] of docs.entries()) {
    if (i > 0) await sleep(GAP_MS);
    const id = await upload(d.paths, d.mime);
    const audit = await poll(id);
    const row = { file: d.file, list: d.list, pair: Boolean(d.pair), id, provider: audit.provider, status: audit.status, error: audit.error, costUsd: audit.costUsd, ms: audit.modelMs };
    if (audit.report) {
      row.verdicts = Object.fromEntries(audit.report.findings.map((f) => [f.checkId, f.verdict]));
      row.pages = Object.fromEntries(audit.report.findings.filter((f) => f.evidence?.page).map((f) => [f.checkId, f.evidence.page]));
    }
    if (audit.extraction) Object.assign(row, score(d.list, groundTruth(d.list, d.page), audit.extraction));
    rows.push(row);
    console.log(`${d.file.padEnd(16)} ${audit.provider} ${audit.status}${audit.error ? ` (${audit.error})` : ''} ${usd(audit.costUsd)}`);
  }

  console.log(`\nprovider  ${[...new Set(rows.map((r) => r.provider))].join(',')}   base ${BASE}`);
  console.log(['file'.padEnd(16), 'fields'.padStart(8), 'disc'.padStart(6), 'verb'.padStart(6), 'xtra'.padStart(5), 'cost'.padStart(9), 'ms'.padStart(7), 'note'].join(' '));
  const sum = { f: { right: 0, total: 0 }, d: { right: 0, total: 0 }, v: { right: 0, total: 0 }, extra: 0, cost: 0, ms: 0 };
  for (const r of rows) {
    if (r.fields) {
      sum.f.right += r.fields.right; sum.f.total += r.fields.total;
      sum.d.right += r.disc.right; sum.d.total += r.disc.total;
      sum.v.right += r.verbatim.right; sum.v.total += r.verbatim.total;
      sum.extra += r.extra;
    }
    sum.cost += r.costUsd; sum.ms += r.ms;
    console.log([
      r.file.padEnd(16),
      (r.fields ? fmtRatio(r.fields) : '-').padStart(8),
      (r.disc ? fmtRatio(r.disc) : '-').padStart(6),
      (r.verbatim ? fmtRatio(r.verbatim) : '-').padStart(6),
      String(r.extra ?? '-').padStart(5),
      usd(r.costUsd).padStart(9),
      String(r.ms).padStart(7),
      r.error ?? '',
    ].join(' '));
  }
  const pct = (r) => (r.total ? `${((100 * r.right) / r.total).toFixed(1)}%` : '-');
  console.log(['TOTAL'.padEnd(16), fmtRatio(sum.f).padStart(8), fmtRatio(sum.d).padStart(6), fmtRatio(sum.v).padStart(6), String(sum.extra).padStart(5), usd(sum.cost).padStart(9), String(sum.ms).padStart(7)].join(' '));
  console.log(`fields ${pct(sum.f)}  disclosures ${pct(sum.d)}  verbatim ${pct(sum.v)}  mean ms ${Math.round(sum.ms / Math.max(rows.length, 1))}`);

  console.log('\nMisses');
  for (const r of rows) for (const m of r.misses ?? []) if (m) console.log(`  ${r.file}: ${m}`);
  if (SET === 'pairs') {
    console.log('\nPhoto-only fails (fail on the photos, not fail on the PDF)');
    for (const r of rows.filter((x) => x.pair)) {
      const pdf = rows.find((x) => !x.pair && x.list === r.list);
      const fails = Object.entries(r.verdicts ?? {}).filter(([, v]) => v === 'fail').map(([id]) => id);
      if (!pdf?.verdicts) {
        console.log(`  ${r.list}: fails [${fails.join(' ')}]  (no PDF report on this provider to compare)`);
        continue;
      }
      const photoOnly = fails.filter((id) => pdf.verdicts[id] !== 'fail');
      const changed = Object.keys(r.verdicts ?? {}).filter((id) => r.verdicts[id] !== pdf.verdicts[id]).map((id) => `${id} ${pdf.verdicts[id]}->${r.verdicts[id]}`);
      const cited = [...new Set(Object.values(r.pages ?? {}))].sort();
      console.log(`  ${r.list}: fails [${fails.join(' ')}]  photo-only [${photoOnly.join(' ')}]  verdict changes vs PDF [${changed.join(', ')}]  pages cited [${cited.join(',')}]`);
    }
  }
  if (args.out) writeFileSync(args.out, JSON.stringify(rows, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
export { groundTruth };
