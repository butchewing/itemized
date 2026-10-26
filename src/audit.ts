export const AUDIT_STATUSES = ['queued', 'extracting', 'checking', 'done', 'failed'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

const TRANSITIONS: Record<AuditStatus, readonly AuditStatus[]> = {
  queued: ['extracting', 'failed'],
  extracting: ['checking', 'failed'],
  checking: ['done', 'failed'],
  done: [],
  failed: [],
};

export function canTransition(from: AuditStatus, to: AuditStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const PROVIDERS = ['meta-api', 'open-weights'] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

export const ACCEPTED_TYPES = {
  'application/pdf': { label: 'PDF' },
  'image/jpeg': { label: 'JPEG' },
  'image/png': { label: 'PNG' },
  'image/webp': { label: 'WebP' },
} as const;
export type AcceptedType = keyof typeof ACCEPTED_TYPES;

export function isAcceptedType(value: string): value is AcceptedType {
  return Object.hasOwn(ACCEPTED_TYPES, value);
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 10;
// Every page is base64-encoded into one model request, so the total stays well inside Worker memory.
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

export type ImageType = Exclude<AcceptedType, 'application/pdf'>;

// A review reads one PDF, or page images in page order. Each object lives in R2 at docs/<its sha256>.
export type StoredPage = { key: string; contentType: ImageType };
export type AuditDocument = { kind: 'pdf'; key: string } | { kind: 'pages'; pages: StoredPage[] };

export const docKey = (sha256: string) => `docs/${sha256}`;

export const sha256Hex = async (bytes: BufferSource) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Order-sensitive, so the same photos in a different order are a different document.
export const combinedSha256 = (pageShas: readonly string[]) => sha256Hex(new TextEncoder().encode(pageShas.join('\n')));

export type Upload = { kind: 'pdf'; file: File } | { kind: 'pages'; files: File[] };
export type UploadError = { status: 400 | 413 | 415; error: string };

export function parseUpload(entries: readonly unknown[], maxPages: number): Upload | UploadError {
  const files = entries.filter((e): e is File => e instanceof File);
  if (!files.length) return { status: 400, error: 'Expected a multipart "file" field.' };
  for (const f of files) {
    if (!isAcceptedType(f.type)) return { status: 415, error: 'Unsupported file type. Upload a PDF, JPEG, PNG or WebP.' };
    if (f.size === 0 || f.size > MAX_UPLOAD_BYTES) return { status: 413, error: 'File must be between 1 byte and 20 MB.' };
  }
  const pdfs = files.filter((f) => f.type === 'application/pdf');
  if (pdfs.length) {
    if (files.length > 1) return { status: 400, error: 'Upload one PDF, or images of each page, not both.' };
    return { kind: 'pdf', file: pdfs[0]! };
  }
  if (files.length > maxPages) return { status: 400, error: `Upload at most ${maxPages} pages.` };
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return { status: 413, error: 'Files must total 24 MB or less.' };
  return { kind: 'pages', files };
}

export type AuditMessage = { auditId: string };
