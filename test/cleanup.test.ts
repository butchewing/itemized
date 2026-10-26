import { describe, expect, it } from 'vitest';
import { planCleanup, type CleanupAuditRow } from '../src/cleanup';

const NOW = new Date('2026-12-01T07:17:00.000Z');
const daysAgo = (d: number, extraMs = 0) => new Date(NOW.getTime() - d * 86_400_000 - extraMs).toISOString();
const row = (id: string, sha: string, lastUsed: string, provider: CleanupAuditRow['provider'] = 'meta-api'): CleanupAuditRow => ({
  id,
  doc_sha256: sha,
  provider,
  last_used_at: lastUsed,
});

describe('planCleanup', () => {
  it('deletes audits last used more than 30 days ago and keeps the rest', () => {
    const plan = planCleanup([row('old', 'a', daysAgo(30, 1)), row('edge', 'b', daysAgo(30)), row('new', 'c', daysAgo(1))], NOW);
    expect(plan.cutoff).toBe(daysAgo(30));
    expect(plan.auditIds).toEqual(['old']);
    expect(plan.cachePairs).toEqual([{ sha256: 'a', provider: 'meta-api' }]);
    expect(plan.docShas).toEqual(['a']);
  });

  it('keeps the cache and the stored file while another live audit uses the same document', () => {
    const plan = planCleanup([row('old', 'a', daysAgo(45)), row('reused', 'a', daysAgo(2))], NOW);
    expect(plan.auditIds).toEqual(['old']);
    expect(plan.cachePairs).toEqual([]);
    expect(plan.docShas).toEqual([]);
  });

  it('keys the cache per provider but the stored file per document', () => {
    const plan = planCleanup([row('old', 'a', daysAgo(45), 'meta-api'), row('live', 'a', daysAgo(2), 'open-weights')], NOW);
    expect(plan.cachePairs).toEqual([{ sha256: 'a', provider: 'meta-api' }]);
    expect(plan.docShas).toEqual([]);
  });

  it('lists each document once when several expired audits share it', () => {
    const plan = planCleanup([row('x', 'a', daysAgo(40)), row('y', 'a', daysAgo(50))], NOW);
    expect(plan.auditIds).toEqual(['x', 'y']);
    expect(plan.cachePairs).toEqual([{ sha256: 'a', provider: 'meta-api' }]);
    expect(plan.docShas).toEqual(['a']);
  });

  it('plans nothing when nothing is stale', () => {
    expect(planCleanup([row('new', 'c', daysAgo(0))], NOW)).toEqual({ cutoff: daysAgo(30), auditIds: [], cachePairs: [], docShas: [] });
    expect(planCleanup([], NOW).auditIds).toEqual([]);
  });
});
