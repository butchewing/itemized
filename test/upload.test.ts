import { describe, expect, it } from 'vitest';
import { combinedSha256, MAX_UPLOAD_BYTES, parseUpload, sha256Hex } from '../src/audit';
import type { GplExtraction } from '../src/extraction';
import { renderLetterHtml } from '../src/letter';
import { betterRead, MIN_NOTICE_BLOCKS, needsReread, pagesInstruction } from '../src/pipeline';
import { auditDocument, documentKeys, loadReview, type AuditRow } from '../src/store';
import type { Report } from '../src/rules/types';

const MB = 1024 * 1024;
// File.size is all parseUpload reads, so a sparse stand-in avoids allocating 20 MB buffers.
const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const jpeg = (n: number, size?: number) => file(`p${n}.jpeg`, 'image/jpeg', size);
const pdf = () => file('list.pdf', 'application/pdf');

describe('combinedSha256', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);

  it('changes when the same pages come in a different order', async () => {
    expect(await combinedSha256([a, b])).not.toBe(await combinedSha256([b, a]));
  });

  it('is stable for the same ordered pages, and differs from any single page hash', async () => {
    expect(await combinedSha256([a, b])).toBe(await combinedSha256([a, b]));
    expect(await combinedSha256([a])).not.toBe(a);
    expect(await combinedSha256([a])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the newline-joined page hashes', async () => {
    expect(await combinedSha256([a, b])).toBe(await sha256Hex(new TextEncoder().encode(`${a}\n${b}`)));
  });
});

describe('parseUpload', () => {
  it('accepts one PDF', () => {
    expect(parseUpload([pdf()])).toMatchObject({ kind: 'pdf' });
  });

  it('accepts page images in the order given', () => {
    const files = [jpeg(1), file('p2.png', 'image/png'), file('p3.webp', 'image/webp')];
    const out = parseUpload(files);
    expect(out).toEqual({ kind: 'pages', files });
  });

  it('rejects a PDF mixed with images, and two PDFs', () => {
    expect(parseUpload([pdf(), jpeg(1)])).toMatchObject({ status: 400 });
    expect(parseUpload([jpeg(1), pdf()])).toMatchObject({ status: 400 });
    expect(parseUpload([pdf(), pdf()])).toMatchObject({ status: 400 });
  });

  it('rejects more pages than the cap', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => jpeg(i));
    expect(parseUpload(eleven)).toEqual({ status: 400, error: 'Upload at most 10 pages.' });
    expect(parseUpload(eleven.slice(0, 10))).toMatchObject({ kind: 'pages' });
  });

  it('enforces the per-file size on every file', () => {
    expect(parseUpload([jpeg(1), jpeg(2, MAX_UPLOAD_BYTES + 1)])).toMatchObject({ status: 413 });
    expect(parseUpload([jpeg(1, 0)])).toMatchObject({ status: 413 });
    expect(parseUpload([jpeg(1, MAX_UPLOAD_BYTES)])).toMatchObject({ kind: 'pages' });
  });

  it('enforces the total size across pages', () => {
    const twelve = (n: number) => jpeg(n, 12 * MB);
    expect(parseUpload([twelve(1), twelve(2)])).toMatchObject({ kind: 'pages' });
    expect(parseUpload([twelve(1), twelve(2), jpeg(3)])).toMatchObject({ status: 413 });
  });

  it('rejects no files and unsupported types', () => {
    expect(parseUpload([])).toMatchObject({ status: 400 });
    expect(parseUpload(['not a file'])).toMatchObject({ status: 400 });
    expect(parseUpload([jpeg(1), file('x.gif', 'image/gif')])).toMatchObject({ status: 415 });
  });
});

describe('auditDocument', () => {
  it('reads page lists, PDFs and single images stored before page lists existed', () => {
    const pages = [{ key: 'docs/p1', contentType: 'image/jpeg' }, { key: 'docs/p2', contentType: 'image/png' }];
    const listed = auditDocument({ doc_key: 'docs/p1', content_type: 'image/jpeg', pages: JSON.stringify(pages) });
    expect(listed).toEqual({ kind: 'pages', pages });
    expect(documentKeys(listed)).toEqual(['docs/p1', 'docs/p2']);
    expect(auditDocument({ doc_key: 'docs/x', content_type: 'application/pdf', pages: null })).toEqual({ kind: 'pdf', key: 'docs/x' });
    expect(auditDocument({ doc_key: 'docs/y', content_type: 'image/webp', pages: null })).toEqual({
      kind: 'pages',
      pages: [{ key: 'docs/y', contentType: 'image/webp' }],
    });
  });
});

describe('pagesInstruction', () => {
  it('keeps the single-page wording and maps each image to its page for longer lists', () => {
    expect(pagesInstruction(1)).toBe('Transcribe this General Price List.');
    expect(pagesInstruction(2)).toBe(
      'Transcribe this General Price List. It has 2 pages, sent as 2 images in page order: image 1 is page 1, image 2 is page 2.',
    );
  });
});

describe('the re-read guard', () => {
  const read = (blocks: number) =>
    ({ disclosures: Array.from({ length: blocks }, (_, i) => ({ id: 'unknown', text: `notice ${i}`, page: 1 })) }) as unknown as GplExtraction;

  it('re-reads only when a read finds fewer notice blocks than a complete list carries', () => {
    expect(needsReread(read(0))).toBe(true);
    expect(needsReread(read(MIN_NOTICE_BLOCKS - 1))).toBe(true);
    expect(needsReread(read(MIN_NOTICE_BLOCKS))).toBe(false);
  });

  it('keeps the read with more notice text, and the first on a tie', () => {
    const first = read(1);
    const more = read(6);
    expect(betterRead(first, more)).toBe(more);
    expect(betterRead(more, first)).toBe(more);
    const tie = read(1);
    expect(betterRead(first, tie)).toBe(first);
  });
});

describe('the letter fingerprint of a photo list', () => {
  it('is the combined hash of the pages, not any page hash', async () => {
    const p1 = await sha256Hex(new TextEncoder().encode('page one'));
    const p2 = await sha256Hex(new TextEncoder().encode('page two'));
    const combined = await combinedSha256([p1, p2]);
    const row: AuditRow = {
      id: 'r1', status: 'done', provider: 'meta-api', doc_key: `docs/${p1}`, doc_sha256: combined, content_type: 'image/jpeg',
      filename: 'p1.jpeg', error: null, created_at: '2026-10-26T18:00:00.000Z', updated_at: '2026-10-26T18:01:00.000Z',
      last_used_at: '2026-10-26T18:00:00.000Z', versions: null,
      pages: JSON.stringify([{ key: `docs/${p1}`, contentType: 'image/jpeg' }, { key: `docs/${p2}`, contentType: 'image/jpeg' }]),
    };
    const report: Report = { rulesetId: 'ftc-453', rulesetVersion: '2026.1', findings: [], counts: { fail: 0, review: 0, pass: 0, not_applicable: 0 }, notRun: [] };
    const extraction = { providerName: 'Juniper Hollow Funeral Home' } as GplExtraction;
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('FROM audits')) return row;
            if (sql.includes('FROM extractions')) return { json: JSON.stringify(extraction) };
            if (sql.includes('FROM reports')) return { json: JSON.stringify(report) };
            return null;
          },
        }),
      }),
    } as unknown as D1Database;

    const view = await loadReview(db, 'r1');
    if (typeof view === 'string') throw new Error(view);
    const html = renderLetterHtml(view);
    expect(html).toContain(`(file fingerprint ${combined.slice(0, 12)})`);
    expect(html).not.toContain(p1.slice(0, 12));
    expect(html).not.toContain(p2.slice(0, 12));
  });
});
