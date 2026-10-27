#!/usr/bin/env node
// One command for the whole eval: renders page images, starts a local Worker per provider, uploads
// every set through the real pipeline (cached extractions and semantic results make reruns free),
// scores verdicts against labels and writes:
//   test/eval/results.json   synthetic and FTC sets (public)
//   EVAL.md                  public table: synthetic, FTC, and real-corpus aggregates only
//   corpus/eval/results.json real-corpus per-list results (private, gitignored)
//   corpus/eval/fails-review.md every real-corpus fail, for a person to judge (private)
//   npm run eval [-- --sets a,b,c,d,e,f] [--port 8790] [--cap-meta-api 1] [--cap-open-weights 4]
//   node test/eval/run.mjs [--config wrangler.jsonc] ...   the portable config, for a fresh checkout
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { groundTruth, score } from '../eval-extraction.mjs';
import {
  assertSetAllowed, assertUploadAllowed, buildSets, CORPUS, OPEN_WEIGHTS_MAX_IMAGES, REDACTED_ELEMENT_CHECKS, ROOT,
} from './sets.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
// npm run eval passes wrangler.production.jsonc, whose local state holds this machine's caches.
const CONFIG = args.config ?? 'wrangler.jsonc';
const PORT = Number(args.port ?? 8790);
const BASE = `http://127.0.0.1:${PORT}`;
const ONLY = args.sets ? new Set(args.sets.split(',')) : null;
const CAPS = { 'meta-api': Number(args['cap-meta-api'] ?? 1), 'open-weights': Number(args['cap-open-weights'] ?? 4) };
const PRIVATE_DIR = join(CORPUS, 'eval');
const PUBLIC_RESULTS = join(ROOT, 'test/eval/results.json');
const ENGINE_VERSION_NOTE = readFileSync(join(ROOT, 'src/rules/engine.ts'), 'utf8').match(/ENGINE_VERSION = '([^']+)'/)[1];
const MODELS = { 'meta-api': 'Muse Spark 1.3 (Meta Model API)', 'open-weights': 'Muse Spark Open (Baseten)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

function render(set) {
  for (const r of set.render ?? []) {
    const out = spawnSync('swift', [join(ROOT, 'test/eval/render-pages.swift'), r.pdf, r.out, '150'], { encoding: 'utf8' });
    if (out.status !== 0) throw new Error(`render ${relative(ROOT, r.pdf)}: ${out.stderr}`);
  }
}

async function startWorker(provider) {
  if (await fetch(`${BASE}/dev/provider`).then(() => true, () => false)) throw new Error(`port ${PORT} is already serving; stop that process or pass --port`);
  mkdirSync(join(PRIVATE_DIR, 'logs'), { recursive: true });
  const log = createWriteStream(join(PRIVATE_DIR, 'logs', `wrangler-${provider}.log`));
  const child = spawn(
    'npx',
    ['wrangler', 'dev', '-c', CONFIG, '--port', String(PORT), '--ip', '127.0.0.1', '--var', `MODEL_PROVIDER:${provider}`, '--var', 'DEV_ROUTES:1'],
    { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  // Resolves once the port refuses connections, so the next provider's Worker cannot be confused
  // with this one still shutting down.
  const stop = async () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
    for (let t = 0; t < 30; t++) {
      if (!(await fetch(`${BASE}/dev/provider`).then(() => true, () => false))) return;
      await sleep(500);
    }
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  };
  for (let t = 0; t < 120; t++) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited (${child.exitCode}); see ${relative(ROOT, join(PRIVATE_DIR, 'logs'))}`);
    try {
      const { provider: running } = await getJson('/dev/provider');
      return { running, stop };
    } catch {
      await sleep(1000);
    }
  }
  await stop();
  throw new Error('wrangler dev did not start');
}

async function upload(paths, mime) {
  for (;;) {
    const form = new FormData();
    for (const p of paths) form.append('file', new Blob([readFileSync(p)], { type: mime }), p.split('/').at(-1));
    const res = await fetch(`${BASE}/api/audits`, { method: 'POST', body: form });
    if (res.status === 429) {
      await sleep(12000);
      continue;
    }
    if (!res.ok) throw new Error(`upload: ${res.status} ${await res.text()}`);
    return (await res.json()).id;
  }
}

async function poll(id) {
  const t0 = Date.now();
  while (Date.now() - t0 < 600_000) {
    const a = await getJson(`/api/audits/${id}`);
    if (a.status === 'done' || a.status === 'failed') return a;
    await sleep(2000);
  }
  throw new Error(`audit ${id} timed out`);
}

const RANK = { fail: 3, review: 2, pass: 1, not_applicable: 0 };
function byCheck(report) {
  const out = {};
  for (const f of report.findings) if (!out[f.checkId] || RANK[f.verdict] > RANK[out[f.checkId]]) out[f.checkId] = f.verdict;
  return out;
}

// Returns verdicts after the redaction policy, and which checks it changed.
function applyRedaction(verdicts, redacted = []) {
  const adjusted = { ...verdicts };
  const changed = [];
  for (const el of redacted) {
    const id = REDACTED_ELEMENT_CHECKS[el];
    if (id && adjusted[id] && adjusted[id] !== 'pass') {
      changed.push({ check: id, raw: adjusted[id] });
      adjusted[id] = 'pass';
    }
  }
  return { adjusted, changed };
}

function compare(verdicts, labels, unlistedPass) {
  const out = { compared: 0, agree: 0, falseFail: [], missedFail: [], failToReview: [], other: [], notRun: [] };
  const ids = unlistedPass ? Object.keys(verdicts) : Object.keys(labels);
  for (const id of ids) {
    const exp = labels[id] ?? { expected: 'pass' };
    const accepted = [exp.expected, ...(exp.also_ok ?? [])];
    const got = verdicts[id];
    if (!got) {
      out.notRun.push(id);
      continue;
    }
    out.compared++;
    const row = { check: id, expected: accepted.join('|'), got };
    if (accepted.includes(got)) out.agree++;
    else if (got === 'fail') out.falseFail.push(row);
    else if (exp.expected === 'fail' && (got === 'pass' || got === 'not_applicable')) out.missedFail.push(row);
    else if (exp.expected === 'fail' && got === 'review') out.failToReview.push(row);
    else out.other.push(row);
  }
  return out;
}

async function runDoc(set, doc) {
  const row = { set: set.id, key: doc.key, list: doc.list };
  if (set.provider === 'open-weights' && doc.paths.length > OPEN_WEIGHTS_MAX_IMAGES) {
    return { ...row, skipped: `${doc.paths.length} pages; the open-weights provider takes at most ${OPEN_WEIGHTS_MAX_IMAGES} images` };
  }
  if (!doc.paths.length) throw new Error(`${doc.key}: no input files (render step missing?)`);
  const { provider: running } = await getJson('/dev/provider');
  assertUploadAllowed(set, doc.paths, running);
  const id = await upload(doc.paths, doc.mime);
  const audit = await poll(id);
  if (audit.provider !== set.provider) throw new Error(`${doc.key}: audit ran on ${audit.provider}, expected ${set.provider}`);
  Object.assign(row, { auditId: id, status: audit.status, error: audit.error });
  if (audit.status !== 'done') return row;

  const ev = await getJson(`/dev/eval/${id}`);
  const modes = set.diagnosticPdfMode ? ['images', 'pdf'] : [set.input];
  row.input = ev.input;
  row.modes = {};
  for (const mode of modes) {
    const report = ev.reports[mode];
    const raw = byCheck(report);
    const { adjusted, changed } = applyRedaction(raw, doc.redacted);
    const verdicts = adjusted;
    const counts = { fail: 0, review: 0, pass: 0, not_applicable: 0 };
    for (const v of Object.values(verdicts)) counts[v]++;
    row.modes[mode] = {
      verdicts,
      redactionAdjusted: changed,
      counts,
      checksRun: Object.keys(verdicts).length,
      notRun: report.notRun,
      labels: doc.labels ? compare(verdicts, doc.labels, doc.unlistedPass) : null,
      ...(set.private && { fails: report.findings.filter((f) => f.verdict === 'fail') }),
    };
  }
  const extract = ev.cost.extract, judge = ev.cost.semantic;
  row.cost = {
    usd: (extract?.usd ?? 0) + (judge?.usd ?? 0),
    ms: (extract?.ms ?? 0) + (judge?.ms ?? 0),
    complete: Boolean(extract && judge),
  };
  if (doc.truth) {
    const s = score(doc.truth, groundTruth(doc.truth, null), ev.extraction);
    row.extraction = { fields: s.fields, disclosures: s.disc, misses: s.misses.filter(Boolean) };
  }
  return row;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const p90 = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(0.9 * xs.length) - 1] : null);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);

function summarize(set, rows, mode) {
  const done = rows.filter((r) => r.modes?.[mode]);
  const m = done.map((r) => r.modes[mode]);
  const labeled = m.filter((x) => x.labels);
  const lab = (k) => done.filter((r) => r.modes[mode].labels).flatMap((r) => r.modes[mode].labels[k].map((row) => ({ list: r.list, ...row })));
  const costed = done.filter((r) => r.cost.complete);
  const ext = done.filter((r) => r.extraction);
  return {
    set: set.id, name: set.name, provider: set.provider, mode, private: Boolean(set.private),
    n: done.length,
    skipped: rows.filter((r) => r.skipped).map((r) => ({ list: r.list, why: r.skipped })),
    failed: rows.filter((r) => r.status === 'failed').map((r) => ({ list: r.list, error: r.error })),
    labeledDocs: labeled.length,
    fields: ext.length ? { right: sum(ext.map((r) => r.extraction.fields.right)), total: sum(ext.map((r) => r.extraction.fields.total)) } : null,
    disclosures: ext.length ? { right: sum(ext.map((r) => r.extraction.disclosures.right)), total: sum(ext.map((r) => r.extraction.disclosures.total)) } : null,
    agreement: labeled.length ? { agree: sum(labeled.map((x) => x.labels.agree)), compared: sum(labeled.map((x) => x.labels.compared)) } : null,
    falseFails: lab('falseFail'),
    missedFails: lab('missedFail'),
    failsToReview: lab('failToReview'),
    otherMismatches: lab('other'),
    verdicts: Object.fromEntries(['fail', 'review', 'pass', 'not_applicable'].map((v) => [v, sum(m.map((x) => x.counts[v]))])),
    redactionAdjusted: sum(m.map((x) => x.redactionAdjusted.length)),
    checksRun: sum(m.map((x) => x.checksRun)),
    notRun: sum(m.map((x) => x.notRun.length)),
    cost: { n: costed.length, mean: mean(costed.map((r) => r.cost.usd)), p90: p90(costed.map((r) => r.cost.usd)) },
    latencyMs: { n: costed.length, mean: mean(costed.map((r) => r.cost.ms)), p90: p90(costed.map((r) => r.cost.ms)) },
  };
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const ratio = (r, a = 'right', b = 'total') => (r ? `${r[a]}/${r[b]}` : 'n/a');
const usd = (n) => (n === null ? 'n/a' : `$${n.toFixed(4)}`);
const secs = (ms) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);

function tableRow(s, label) {
  return `| ${label} | ${MODELS[s.provider]} | ${s.n} | ${ratio(s.fields)} | ${ratio(s.disclosures)} | ${
    s.agreement ? `${ratio(s.agreement, 'agree', 'compared')} (${pct(s.agreement.agree, s.agreement.compared)})` : 'n/a'
  } | ${s.labeledDocs ? s.falseFails.length : 'n/a'} | ${s.labeledDocs ? s.missedFails.length : 'n/a'} | ${s.labeledDocs ? s.failsToReview.length : 'n/a'} | ${pct(
    s.verdicts.review, s.checksRun,
  )} | ${s.notRun} | ${usd(s.cost.mean)} / ${usd(s.cost.p90)} | ${secs(s.latencyMs.mean)} / ${secs(s.latencyMs.p90)} |`;
}

const LABEL = {
  a: 'a. Synthetic PDFs', b: 'b. Synthetic photos', c: 'c. Synthetic photos', d: 'd. Synthetic PDFs as page images',
  'd/pdf': 'd. Same extraction, PDF rules (diagnostic)', e: 'e. FTC Sample 1 template',
};

function mismatchLines(s) {
  const all = [
    ...s.falseFails.map((m) => ({ ...m, kind: 'false fail' })),
    ...s.missedFails.map((m) => ({ ...m, kind: 'missed fail' })),
    ...s.failsToReview.map((m) => ({ ...m, kind: 'fail to review' })),
    ...s.otherMismatches.map((m) => ({ ...m, kind: 'other' })),
  ];
  return all.map((m) => `${m.list} ${m.check} (${m.kind}: expected ${m.expected}, got ${m.got})`);
}

function writeEvalMd(summaries, corpusAgg, spend) {
  const pub = summaries.filter((s) => !s.private);
  const lines = [
    '# Itemized eval',
    '',
    'Produced by `npm run eval` (`test/eval/run.mjs`). Machine-readable results for the public sets are in `test/eval/results.json`.',
    '',
    '## Results',
    '',
    '| Set | Model | n | Fields | Disclosures | Verdict agreement | False fails | Missed fails | Fail to review | Review rate | Checks not run | Cost per review, mean / p90 | Model time per review, mean / p90 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...pub.map((s) => tableRow(s, LABEL[s.mode === 'pdf' && s.set === 'd' ? 'd/pdf' : s.set])),
  ];
  if (corpusAgg) {
    const c = corpusAgg;
    lines.push(
      '',
      '## Real price lists (aggregates only)',
      '',
      `${c.n} redacted real General Price Lists ran on Muse Spark Open through Baseten, as page images. ${c.skipped} more have more than ${OPEN_WEIGHTS_MAX_IMAGES} pages and were not run, because the open-weights provider takes at most ${OPEN_WEIGHTS_MAX_IMAGES} images per request. No real list was sent to the Meta Model API.`,
      '',
      '| Measure | Value |',
      '|---|---|',
      `| Lists run | ${c.n} |`,
      `| Verdicts (fail / review / pass / not applicable) | ${c.verdicts.fail} / ${c.verdicts.review} / ${c.verdicts.pass} / ${c.verdicts.not_applicable} |`,
      `| Fails per list, mean | ${(c.verdicts.fail / Math.max(c.n, 1)).toFixed(1)} |`,
      `| Review rate | ${pct(c.verdicts.review, c.checksRun)} |`,
      `| Checks not run | ${c.notRun} |`,
      `| Name, address or phone checks counted as pass because the element was redacted | ${c.redactionAdjusted} |`,
      `| Hand-labeled list: verdict agreement | ${c.labeled ? `${c.labeled.agree}/${c.labeled.compared}` : 'n/a'} |`,
      `| Hand-labeled list: false fails / missed fails / fail to review | ${c.labeled ? `${c.labeled.falseFails} / ${c.labeled.missedFails} / ${c.labeled.failsToReview}` : 'n/a'} |`,
      `| Same extractions under the PDF rules (diagnostic): fails, and lists with at least one | ${c.pdfRules.verdicts.fail}, ${c.pdfRules.listsWithFail} of ${c.n} |`,
      `| Hand-labeled list under the PDF rules: agreement; false fails / missed fails | ${c.pdfRules.labeled ? `${c.pdfRules.labeled.agree}/${c.pdfRules.labeled.compared}; ${c.pdfRules.labeled.falseFails} / ${c.pdfRules.labeled.missedFails}` : 'n/a'} |`,
      `| Cost per review, mean / p90 | ${usd(c.cost.mean)} / ${usd(c.cost.p90)} |`,
      `| Model time per review, mean / p90 | ${secs(c.latencyMs.mean)} / ${secs(c.latencyMs.p90)} |`,
    );
  }
  lines.push(
    '',
    '## Off-label verdicts in the public sets',
    '',
    ...pub.flatMap((s) => {
      const ms = mismatchLines(s);
      return [`${LABEL[s.mode === 'pdf' && s.set === 'd' ? 'd/pdf' : s.set]}, ${s.provider}${ms.length ? ':' : ': none.'}`, ...ms.map((m) => `- ${m}`), ''];
    }),
    '## Method',
    '',
    '- Every set goes through the local Worker the same way an upload does: store, queue, extract, semantic checks, rules engine. The harness then asks a development route for the engine verdicts on the cached extraction, with the audit date fixed at 2026-10-26 so the stale-date check does not drift between runs.',
    '- Fields and disclosures score the extraction against ground truth parsed from the synthetic lists\' HTML sources (`test/eval-extraction.mjs`). The FTC template and the real lists have no field-level ground truth.',
    '- Verdicts are compared per check with `prep/synthetic/labels.json`, `specimens/labels.json` (checks it does not list are expected to pass) and the hand labels for one real list. A check with several findings counts as its most severe verdict. Agreement means the verdict is the label or one of its `also_ok` alternatives. A false fail is a fail the label does not allow. A missed fail is a labeled fail that came back pass or not applicable. Fail to review is a labeled fail that came back review, which is the intended result on photos whenever a misread could explain the fail.',
    '- Review rate is reviews divided by checks run. Checks not run are semantic checks whose model step was skipped.',
    '- Photo and page-image sets run with the photo rule (engine input `images`). Set d also shows the same extraction under the PDF rules, so the true fails the photo rule turns into reviews are visible.',
    '- Page images for sets d and the real lists are rendered at 150 DPI, 8-bit grayscale, with PDFKit (`test/eval/render-pages.swift`), outside the Worker.',
    `- Verdicts come from rules engine version \`${ENGINE_VERSION_NOTE}\`.`,
    '- Cost and model time per review are the extraction call plus the semantic call that produced each cached result, read from the local `model_calls` table. Each document ran once (n=1 per document and model). The numbers carry sampling noise that a single run cannot show.',
    '- Real price lists ran only on Muse Spark Open through Baseten. The harness refuses any real-list file unless the running Worker reports the open-weights provider, and a test asserts that rule. Per-list results stay in a private, gitignored folder; this file carries aggregates only.',
    '',
    '## Rerun',
    '',
    'On the machine that produced these numbers:',
    '',
    '```',
    'npm run eval',
    '```',
    '',
    'It starts `wrangler dev -c wrangler.production.jsonc` itself (local state only, nothing deployed), once per provider, with development routes on, and reads the cached extractions, semantic results and rendered page images, so it costs nothing. From a fresh checkout, with keys in `.dev.vars`, use the portable configuration instead. It makes new model calls:',
    '',
    '```',
    'npx wrangler d1 migrations apply DB --local',
    'node test/eval/run.mjs --sets a,b,c,d,e',
    '```',
    '',
    'Spend is capped per run at $1 on the Meta Model API and $4 on Baseten (`--cap-meta-api`, `--cap-open-weights`). Set f needs the private corpus, so leave it out of `--sets` elsewhere.',
    '',
    `This run spent ${usd(spend['meta-api'] ?? 0)} on the Meta Model API and ${usd(spend['open-weights'] ?? 0)} on Baseten.`,
    '',
  );
  writeFileSync(join(ROOT, 'EVAL.md'), lines.join('\n'));
}

// Checks where open-weights page-image extractions of synthetic lists came back off label: a real-list
// fail on one of these is the first place to suspect the extraction rather than the list.
function extractionGapChecks(summaries) {
  const ids = new Set();
  for (const s of summaries.filter((x) => (x.set === 'c' || x.set === 'd') && x.mode === 'images')) {
    for (const m of [...s.falseFails, ...s.otherMismatches, ...s.missedFails]) ids.add(m.check);
  }
  return ids;
}

function writeFailsSheet(rows, gapChecks) {
  const hypoPath = join(PRIVATE_DIR, 'hypotheses.json');
  const hypotheses = existsSync(hypoPath) ? JSON.parse(readFileSync(hypoPath, 'utf8')) : {};
  const one = (s) => (s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  const header = [
    '| List | Check | Title | Cite | Evidence | Page | Reason | Synthetic extraction gap on this check? | Hypothesis |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  const table = (mode) => {
    const out = [];
    for (const r of rows.filter((x) => x.modes?.[mode])) {
      const seen = {};
      const redacted = new Set(r.modes[mode].redactionAdjusted.map((c) => c.check));
      for (const f of r.modes[mode].fails.filter((x) => !redacted.has(x.checkId))) {
        seen[f.checkId] = (seen[f.checkId] ?? 0) + 1;
        const h = hypotheses[`${r.list} ${f.checkId} ${seen[f.checkId]}`];
        out.push(
          `| ${r.list} | ${f.checkId} | ${one(f.title)} | ${one(f.cite)} | ${one(f.evidence?.quote) || '(none)'} | ${f.evidence?.page ?? ''} | ${one(f.reason)} | ${
            gapChecks.has(f.checkId) ? 'yes' : 'no'
          } | ${h ? `${h.bucket}: ${one(h.why)}` : 'not yet assessed'} |`,
        );
      }
    }
    return out.length ? [...header, ...out] : ['None.'];
  };
  const lines = [
    '# Real-corpus fails for review',
    '',
    'Private. Open weights only. Judge each row as fair or false. The hypothesis column is Claude\'s guess, not a judgment;',
    'it is keyed in `hypotheses.json` as "<list> <check> <n>" and merged in each time `npm run eval` regenerates this file.',
    '',
    '## Fails as the product reports them (page images, photo rule)',
    '',
    ...table('images'),
    '',
    '## Fails the PDF rules would give on the same extraction (diagnostic)',
    '',
    'The photo rule turns these into review because a misread could explain them. They are the candidate violations a person should check.',
    '',
    ...table('pdf'),
    '',
    '## Counted as pass because the element was redacted',
    '',
    ...rows.filter((x) => x.modes?.pdf?.redactionAdjusted.length).map((r) => `- ${r.list}: ${r.modes.pdf.redactionAdjusted.map((c) => `${c.check} (raw ${c.raw})`).join(', ')}`),
  ];
  const skipped = rows.filter((x) => x.skipped);
  if (skipped.length) lines.push('', '## Not run', '', ...skipped.map((r) => `- ${r.list}: ${r.skipped}`));
  writeFileSync(join(PRIVATE_DIR, 'fails-review.md'), `${lines.join('\n')}\n`);
}

async function main() {
  const sets = buildSets().filter((s) => !ONLY || ONLY.has(s.id));
  for (const s of sets) assertSetAllowed(s);
  for (const s of sets) render(s);
  const fresh = Object.fromEntries(buildSets().map((s) => [s.id, s]));
  const runSets = sets.map((s) => fresh[s.id]);

  const rows = {};
  const spend = {};
  for (const provider of ['meta-api', 'open-weights']) {
    const group = runSets.filter((s) => s.provider === provider);
    if (!group.length) continue;
    const { running, stop } = await startWorker(provider);
    try {
      if (running !== provider) throw new Error(`Worker reports ${running}, wanted ${provider}; check .dev.vars MODEL_PROVIDER`);
      const since = new Date().toISOString();
      for (const set of group) {
        rows[set.id] = [];
        for (const doc of set.docs) {
          const row = await runDoc(set, doc);
          rows[set.id].push(row);
          const spent = (await getJson(`/dev/spend?since=${encodeURIComponent(since)}`))[provider]?.usd ?? 0;
          spend[provider] = spent;
          console.log(`${set.id} ${doc.key.padEnd(14)} ${row.skipped ? 'skipped' : row.status}${row.error ? ` (${row.error})` : ''}  spent ${usd(spent)}`);
          if (spent > CAPS[provider]) throw new Error(`${provider} spend ${usd(spent)} is over the cap ${usd(CAPS[provider])}`);
        }
      }
    } finally {
      await stop();
    }
  }

  const summaries = [];
  for (const set of runSets) {
    const modes = set.diagnosticPdfMode ? ['images', 'pdf'] : [set.input];
    for (const mode of modes) summaries.push(summarize(set, rows[set.id], mode));
  }

  const pubSets = runSets.filter((s) => !s.private);
  const prior = existsSync(PUBLIC_RESULTS) ? JSON.parse(readFileSync(PUBLIC_RESULTS, 'utf8')) : { summaries: [], documents: [] };
  const ran = new Set(pubSets.map((s) => s.id));
  const publicOut = {
    note: 'Synthetic lists and the FTC template only. Real-corpus results live in corpus/eval/ (private).',
    summaries: [...prior.summaries.filter((s) => !ran.has(s.set)), ...summaries.filter((s) => !s.private)].sort((a, b) => a.set.localeCompare(b.set)),
    documents: [
      ...prior.documents.filter((d) => !ran.has(d.set)),
      ...pubSets.flatMap((s) => rows[s.id]),
    ].sort((a, b) => a.set.localeCompare(b.set) || a.key.localeCompare(b.key)),
  };
  writeFileSync(PUBLIC_RESULTS, `${JSON.stringify(publicOut, null, 1)}\n`);

  let corpusAgg = null;
  const priv = runSets.find((s) => s.private);
  const privPath = join(PRIVATE_DIR, 'results.json');
  if (priv) {
    const s = summaries.find((x) => x.set === priv.id && x.mode === 'images');
    const asPdf = summaries.find((x) => x.set === priv.id && x.mode === 'pdf');
    const labeled = (mode) => {
      const l = rows[priv.id].find((r) => r.modes?.[mode]?.labels)?.modes[mode].labels;
      return l ? { agree: l.agree, compared: l.compared, falseFails: l.falseFail.length, missedFails: l.missedFail.length, failsToReview: l.failToReview.length } : null;
    };
    corpusAgg = {
      n: s.n, skipped: s.skipped.length, verdicts: s.verdicts, checksRun: s.checksRun, notRun: s.notRun,
      redactionAdjusted: s.redactionAdjusted, cost: s.cost, latencyMs: s.latencyMs, labeled: labeled('images'),
      pdfRules: { verdicts: asPdf.verdicts, listsWithFail: rows[priv.id].filter((r) => r.modes?.pdf?.counts.fail).length, labeled: labeled('pdf') },
    };
    const gap = extractionGapChecks(publicOut.summaries);
    writeFileSync(privPath, `${JSON.stringify({ aggregate: corpusAgg, summaries: [s, asPdf], extractionGapChecks: [...gap], documents: rows[priv.id] }, null, 1)}\n`);
    writeFailsSheet(rows[priv.id], gap);
  } else if (existsSync(privPath)) {
    corpusAgg = JSON.parse(readFileSync(privPath, 'utf8')).aggregate;
  }

  writeEvalMd(publicOut.summaries, corpusAgg, spend);
  for (const s of publicOut.summaries) console.log(tableRow(s, LABEL[s.mode === 'pdf' && s.set === 'd' ? 'd/pdf' : s.set]));
  console.log(`spend this run: meta-api ${usd(spend['meta-api'] ?? 0)}, open-weights ${usd(spend['open-weights'] ?? 0)}`);
}

await main();
