import { describe, it, expect } from 'vitest';
import { createDataset } from './dataset';

describe('createDataset', () => {
  it('seeds from fixtures and returns all records with an empty cursor', () => {
    const ds = createDataset();
    expect(
      ds
        .list('order', {})
        .map((r) => r.externalId)
        .sort()
    ).toEqual(['1c-order-1001', '1c-order-1002', '1c-order-1003']);
    expect(ds.list('organization', {})).toHaveLength(3);
  });

  it('filters by since (updatedAt > since)', () => {
    const ds = createDataset();
    const ids = ds
      .list('order', { since: '2026-05-10T00:00:00Z' })
      .map((r) => r.externalId)
      .sort();
    expect(ids).toEqual(['1c-order-1001', '1c-order-1002']); // 1003 is 2026-05-05
    expect(
      ds.list('organization', { since: '2026-04-16T00:00:00Z' }).map((r) => r.externalId)
    ).toEqual(['1c-org-003']);
  });

  it('touch() bumps updatedAt so the record reappears after a later cursor', () => {
    const ds = createDataset();
    const future = '2027-01-01T00:00:00Z';
    expect(ds.list('order', { since: future })).toHaveLength(0);
    ds.touch('order', '1c-order-1001', () => new Date('2027-06-06T00:00:00Z'));
    const ids = ds.list('order', { since: future }).map((r) => r.externalId);
    expect(ids).toEqual(['1c-order-1001']);
  });

  it('returns copies — mutating a result does not corrupt the store', () => {
    const ds = createDataset();
    (ds.list('order', {})[0] as Record<string, unknown>).title = 'MUTATED';
    const [afterMutation] = ds.list('order', {});
    expect(afterMutation).toBeDefined();
    expect(afterMutation?.title).not.toBe('MUTATED');
  });
});
