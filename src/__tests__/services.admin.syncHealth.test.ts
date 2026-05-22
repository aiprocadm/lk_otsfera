import { describe, it, expect, vi } from 'vitest';

const summaryRows = vi.hoisted(() => [
  {
    entity: 'organization' as const,
    successCount24h: 12,
    warnCount24h: 0,
    errorCount24h: 1,
    lastSuccessAt: new Date('2026-05-22T10:00:00Z'),
    lastErrorAt: null,
    lastErrorMessage: null,
  },
  {
    entity: 'order' as const,
    successCount24h: 0,
    warnCount24h: 0,
    errorCount24h: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  },
]);

vi.mock('@/lib/services/syncSummary', () => ({
  getSyncSummary: vi.fn().mockResolvedValue(summaryRows),
}));

import { getSyncLag } from '@/lib/services/admin/syncHealth';

describe('getSyncLag', () => {
  it('computes lagMs = now - lastSuccessAt for each entity', async () => {
    const now = new Date('2026-05-22T11:00:00Z');
    const rows = await getSyncLag({} as never, now);
    expect(rows).toHaveLength(2);
    expect(rows[0].entity).toBe('organization');
    expect(rows[0].lagMs).toBe(60 * 60 * 1000); // 1 hour
    expect(rows[0].successCount24h).toBe(12);
    expect(rows[0].errorCount24h).toBe(1);
  });

  it('returns lagMs = null when no successful sync has happened', async () => {
    const rows = await getSyncLag({} as never, new Date());
    const order = rows.find((r) => r.entity === 'order')!;
    expect(order.lagMs).toBeNull();
    expect(order.lastSuccessAt).toBeNull();
  });
});
