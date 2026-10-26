#!/usr/bin/env node
// Re-runs the 13 semantic checks on each synthetic PDF's cached extraction through a local Worker
// started with `--var DEV_ROUTES:1`, bypassing the semantic cache, and compares each sample's
// verdicts with the committed fixture's and with labels.json. Writes the raw samples to
// test/fixtures/semantic-variance/ and a summary to prep/semantic-variance.md.
//   node test/semantic-variance.mjs [--base URL] [--runs 3] [--only syn-01] [--summary-only]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
);
const BASE = args.base ?? 'http://localhost:8787';
const RUNS = Number(args.runs ?? 3);
const PDF = join(ROOT, 'prep/synthetic/pdf');
const FIXTURES = join(ROOT, 'test/fixtures/semantic');
const OUT = join(ROOT, 'test/fixtures/semantic-variance');
const labels = JSON.parse(readFileSync(join(ROOT, 'prep/synthetic/labels.json'), 'utf8'));

const lists = readdirSync(PDF)
  .filter((f) => /^syn-\d{2}\.pdf$/.test(f))
  .map((f) => f.replace('.pdf', ''))
  .filter((l) => !args.only || l === args.only)
  .sort();

async function sample(list) {
  const sha256 = createHash('sha256').update(readFileSync(join(PDF, `${list}.pdf`))).digest('hex');
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${list}.pdf.json`), 'utf8'));
  const res = await fetch(`${BASE}/dev/semantic-variance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256, runs: RUNS, fixture }),
  });
  if (!res.ok) throw new Error(`${list}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  writeFileSync(join(OUT, `${list}.pdf.json`), `${JSON.stringify({ list, ...body }, null, 1)}\n`);
  console.log(`${list} ${body.samples.length} samples $${body.samples.reduce((n, s) => n + s.costUsd, 0).toFixed(4)}`);
}

if (!args['summary-only']) {
  mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < lists.length; i += 4) await Promise.all(lists.slice(i, i + 4).map(sample));
}

const runs = lists.map((list) => JSON.parse(readFileSync(join(OUT, `${list}.pdf.json`), 'utf8')));
const ids = Object.keys(runs[0].fixtureVerdicts);
const labelOf = (list, id) => {
  const c = labels.documents.find((d) => d.id === list).checks[id];
  return [c.expected, ...(c.also_ok ?? [])];
};

const rows = ids.map((id) => {
  let total = 0;
  let changed = 0;
  let offLabel = 0;
  const where = [];
  for (const r of runs) {
    const fx = r.fixtureVerdicts[id];
    const ok = labelOf(r.list, id);
    total++;
    if (!ok.includes(fx)) offLabel++;
    for (const [i, s] of r.samples.entries()) {
      total++;
      const got = s.verdicts?.[id] ?? 'error';
      if (!ok.includes(got)) offLabel++;
      if (got !== fx) {
        changed++;
        where.push(`${r.list} run ${i + 1}: ${fx} -> ${got}`);
      }
    }
  }
  return { id, total, changed, offLabel, where };
});

// Below the verdict: did the model's own applies/concern answers move, or only its wording?
let judged = 0;
let flagsMoved = 0;
let reworded = 0;
for (const r of runs) {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${r.list}.pdf.json`), 'utf8'));
  const byId = Object.fromEntries(fixture.checks.map((c) => [c.id, c]));
  for (const s of r.samples.filter((x) => x.raw)) {
    for (const c of s.raw.checks) {
      judged++;
      if (c.applies !== byId[c.id].applies || c.concern !== byId[c.id].concern) flagsMoved++;
      if (c.explanation !== byId[c.id].explanation) reworded++;
    }
  }
}

const promptVersion = runs[0].promptVersion;
const errors = runs.flatMap((r) => r.samples.filter((s) => !s.verdicts).map((s) => `${r.list}: ${s.error}`));
const cost = runs.reduce((n, r) => n + r.samples.reduce((m, s) => m + s.costUsd, 0), 0);
const md = `# Semantic check variance

Prompt \`${promptVersion}\`, \`muse-spark-1.3\`, reasoning effort low. Each of the 12 synthetic PDFs' cached
extractions was judged ${RUNS} more times with the semantic cache bypassed. With the committed fixture that is
${runs.length} lists x ${RUNS + 1} samples = ${runs.length * (RUNS + 1)} verdicts per check. Raw samples: \`test/fixtures/semantic-variance/\`.
Produced by \`node test/semantic-variance.mjs\`. Cost of the ${RUNS} extra runs: $${cost.toFixed(4)}.

"Differs from fixture" counts samples whose verdict differs from the committed fixture's verdict (the fixture
itself never differs, so the most is ${runs.length * RUNS}). "Off label" counts all ${runs.length * (RUNS + 1)} verdicts that labels.json
does not accept.

| Check | Differs from fixture | Off label | Where |
|---|---|---|---|
${rows.map((r) => `| ${r.id} | ${r.changed}/${r.total} | ${r.offLabel}/${r.total} | ${r.where.join('; ') || 'none'} |`).join('\n')}

Across the ${judged} individual judgments in the extra runs, the model's \`applies\` or \`concern\` answer differed from the
fixture's ${flagsMoved} times, and its explanation was worded differently ${reworded} times.
${errors.length ? `\nSamples that failed: ${errors.join('; ')}\n` : ''}`;
writeFileSync(join(ROOT, 'prep/semantic-variance.md'), md);
console.log(md);
