// The eval's sets, and the rule that real price lists only ever reach the open-weights provider.
// Pure module: test/eval-guard.test.ts imports it without a Worker running.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const CORPUS = join(ROOT, 'corpus');
const SYN = join(ROOT, 'prep/synthetic');
const SYN_PAGES = join(ROOT, 'test/eval/pages');
export const CORPUS_PAGES = join(CORPUS, 'eval/pages');

// Real lists may only go to this provider (PLAN.md "Data handling", decided 2026-10-26).
export const CORPUS_PROVIDER = 'open-weights';
// PROVIDER_CONFIG['open-weights'].maxImages; uploads with more pages are rejected.
export const OPEN_WEIGHTS_MAX_IMAGES = 8;
export const PHOTO_LISTS = ['syn-01', 'syn-03', 'syn-09', 'syn-10'];

export const isCorpusPath = (p) => {
  const rel = relative(CORPUS, p);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep);
};

export class GuardError extends Error {}

// Called with the provider the running Worker reports, before every upload.
export function assertUploadAllowed(set, paths, serverProvider) {
  if (serverProvider !== set.provider) {
    throw new GuardError(`set ${set.id} needs ${set.provider} but the Worker runs ${serverProvider}`);
  }
  for (const p of paths) {
    if (!isCorpusPath(p)) continue;
    if (!set.private) throw new GuardError(`set ${set.id} is public but includes real-corpus file ${relative(ROOT, p)}`);
    if (serverProvider !== CORPUS_PROVIDER) throw new GuardError(`real-corpus file ${relative(ROOT, p)} may only go to ${CORPUS_PROVIDER}`);
    if (!p.endsWith('.png')) throw new GuardError(`real-corpus file ${relative(ROOT, p)} must be a rendered page image`);
  }
}

export function assertSetAllowed(set) {
  if (set.private && set.provider !== CORPUS_PROVIDER) throw new GuardError(`private set ${set.id} must use ${CORPUS_PROVIDER}`);
}

const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^p\d+\.png$/.test(f)).sort().map((f) => join(dir, f)) : []);

// Labels: { expected, also_ok? } per check id. FTC's file lists only non-pass checks.
function synLabels() {
  return Object.fromEntries(json(join(SYN, 'labels.json')).documents.map((d) => [d.id, d.checks]));
}

const synPdfs = () => readdirSync(join(SYN, 'pdf')).filter((f) => /^syn-\d{2}\.pdf$/.test(f)).sort().map((f) => f.replace('.pdf', ''));

export function buildSets() {
  const labels = synLabels();
  const photos = json(join(SYN, 'photos/manifest.json')).photos;
  const photoDoc = (list) => ({
    key: `${list} photos`,
    list,
    paths: photos.filter((p) => p.list === list).sort((a, b) => a.page - b.page).map((p) => join(SYN, 'photos', p.file)),
    mime: 'image/jpeg',
    truth: list,
    labels: labels[list],
  });
  const ftc = json(join(ROOT, 'specimens/labels.json')).documents[0];
  const manifest = existsSync(join(CORPUS, 'manifest.json')) ? json(join(CORPUS, 'manifest.json')).documents : {};
  const corpusLabels = existsSync(join(CORPUS, 'labels.json'))
    ? Object.fromEntries(json(join(CORPUS, 'labels.json')).documents.map((d) => [d.id, d.checks]))
    : {};

  return [
    {
      id: 'a', name: 'Synthetic PDFs', provider: 'meta-api', input: 'pdf',
      docs: synPdfs().map((list) => ({ key: list, list, paths: [join(SYN, 'pdf', `${list}.pdf`)], mime: 'application/pdf', truth: list, labels: labels[list] })),
    },
    { id: 'b', name: 'Synthetic phone photos', provider: 'meta-api', input: 'images', docs: PHOTO_LISTS.map(photoDoc) },
    { id: 'c', name: 'Synthetic phone photos', provider: 'open-weights', input: 'images', docs: PHOTO_LISTS.map(photoDoc) },
    {
      id: 'd', name: 'Synthetic PDFs as page images', provider: 'open-weights', input: 'images', diagnosticPdfMode: true,
      render: synPdfs().map((list) => ({ pdf: join(SYN, 'pdf', `${list}.pdf`), out: join(SYN_PAGES, list) })),
      docs: synPdfs().map((list) => ({ key: list, list, paths: pngs(join(SYN_PAGES, list)), mime: 'image/png', truth: list, labels: labels[list] })),
    },
    {
      id: 'e', name: 'FTC Sample 1 template', provider: 'meta-api', input: 'pdf',
      docs: [{ key: 'ftc-template', list: 'ftc', paths: [join(ROOT, 'specimens', ftc.pdf)], mime: 'application/pdf', truth: null, labels: ftc.checks, unlistedPass: true }],
    },
    {
      id: 'f', name: 'Real price lists (private)', provider: CORPUS_PROVIDER, input: 'images', private: true, diagnosticPdfMode: true,
      render: Object.entries(manifest).map(([id, m]) => ({ pdf: join(CORPUS, m.file), out: join(CORPUS_PAGES, id) })),
      docs: Object.entries(manifest).map(([id, m]) => ({
        key: id, list: id, paths: pngs(join(CORPUS_PAGES, id)), mime: 'image/png', truth: null,
        labels: corpusLabels[id] ?? null, redacted: m.required_elements_redacted, pages: m.pages,
      })),
    },
  ];
}

// ftc-453 policy "redacted_elements": presence checks for an element the redaction removed count as pass.
export const REDACTED_ELEMENT_CHECKS = { name: 'C-002', address: 'C-003', phone: 'C-004' };
