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

export type AuditMessage = { auditId: string };
