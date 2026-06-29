import { describe, it, expect, vi } from 'vitest';
import { isTransientSkip, capturePendingSkips, type CursorEntity } from '@/lib/services/oneCSync/pending';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';

describe('isTransientSkip', () => {
  it('treats dependency-ordering skips as transient', () => {
    expect(isTransientSkip('organization_not_found')).toBe(true);
    expect(isTransientSkip('order_not_found')).toBe(true);
    expect(isTransientSkip('document_fetch_failed')).toBe(true);
  });
  it('treats partner/scope skips as permanent', () => {
    expect(isTransientSkip('partner_not_found')).toBe(false);
    expect(isTransientSkip('no_partner_external_id')).toBe(false);
    expect(isTransientSkip('out_of_scope')).toBe(false);
  });
  it('treats unknown reasons as permanent (fail closed — do not retry forever)', () => {
    expect(isTransientSkip('something_new')).toBe(false);
  });
});

describe('capturePendingSkips', () => {
  const rawByExt = (ext: string) => ({ externalId: ext, updatedAt: '2026-06-01T00:00:00Z' });

  it('upserts a pending row for each transient skip, matched to its raw DTO', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { upsert } } as never;
    const raw = [rawByExt('P1'), rawByExt('P2'), rawByExt('P3')];
    const summary = emptySummary();
    summary.skips = [
      { externalId: 'P1', reason: 'organization_not_found' }, // transient → captured
      { externalId: 'P3', reason: 'out_of_scope' },           // permanent → ignored
    ];

    await capturePendingSkips(db, 'payment' as CursorEntity, raw, (r) => (r as { externalId: string }).externalId, summary);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { entity_externalId: { entity: 'payment', externalId: 'P1' } },
      create: { entity: 'payment', externalId: 'P1', dto: raw[0], reason: 'organization_not_found' },
      update: { reason: 'organization_not_found', status: 'pending' },
    });
  });

  it('does nothing when there are no transient skips', async () => {
    const upsert = vi.fn();
    const db = { oneCPendingRecord: { upsert } } as never;
    const summary = emptySummary();
    summary.skips = [{ externalId: 'X', reason: 'partner_not_found' }];
    await capturePendingSkips(db, 'organization' as CursorEntity, [rawByExt('X')], (r) => (r as { externalId: string }).externalId, summary);
    expect(upsert).not.toHaveBeenCalled();
  });
});
