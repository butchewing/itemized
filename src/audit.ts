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

// Errors an audit records when a PDF cannot be turned into page images; page.ts words them for the reader.
export const PDF_UNSUPPORTED = 'PDF not supported by this model';
export const PDF_UNREADABLE = 'PDF could not be rendered';
export const PDF_TOO_LONG = 'PDF has too many pages to render';

// PDFs for models that read images only are rendered to page images (src/render.ts), the way the eval's
// set d was made. RENDER_VERSION is part of every cache key for rendered reads: bump it when output changes.
export const RENDER_VERSION = 'pdfjs-6.5.438@150dpi-gray';
export const RENDER_DPI = 150;
export const MAX_RENDER_PAGES = 24;
// What a rendered read records: pages and each page's text-layer characters (0 means scanned).
export type RenderInfo = { version: string; pages: number; textChars: number[] };

export const PROVIDERS = [
  'meta-api', 'muse-open', 'gemma-4', 'llama-4-scout', 'qwen-3.8', 'ollama-mistral', 'claude-sonnet', 'claude-haiku',
] as const;
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
// Every page is held base64-encoded for the model requests, so the total stays well inside Worker memory.
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

export function parseUpload(entries: readonly unknown[]): Upload | UploadError {
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
  if (files.length > MAX_PAGES) return { status: 400, error: `Upload at most ${MAX_PAGES} pages.` };
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return { status: 413, error: 'Files must total 24 MB or less.' };
  return { kind: 'pages', files };
}

export type AuditMessage = { auditId: string };

// The states and DC, by USPS code, for the upload form's "state" field.
export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// null: not given (use the list's address). undefined: given but not a state.
export function parseState(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  return typeof v === 'string' && Object.hasOwn(STATES, v) ? v : undefined;
}
