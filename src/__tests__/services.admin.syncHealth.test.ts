import { describe, it, expect, vi } from 'vitest';

const summaryRows = vi.hoisted(() => [
  {
    entity: 'organization' as const,
    successCount24h: 12,
    warnCount24h: 0,
    errorCount24h: 1,
    // Fresh lastSuccessAt but a 1h-STALE cursor — proves lag tracks the cursor,
    // not the success log (the shadow-mode blind spot this fix closes).
    lastSuccessAt: new Date('2026-05-22T11:00:00Z'),
    lastErrorAt: null,
    lastErrorMessage: null,
    cursor: '2026-05-22T10:00:00.000Z',
    lagMs: 12345,
  },
  {
    entity: 'order' as const,
    successCount24h: 0,
    warnCount24h: 0,
    errorCount24h: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    cursor: null,
    lagMs: null,
  },
]);

vi.mock('@/lib/services/syncSummary', () => ({
  getSyncSummary: vi.fn().mockResolvedValue(summaryRows),
}));

import { getSyncLag } from '@/lib/services/admin/syncHealth';

describe('getSyncLag', () => {
  it('computes lagMs from the cursor watermark (not lastSuccessAt)', async () => {
    const now = new Date('2026-05-22T11:00:00Z');
    const rows = await getSyncLag({} as never, now);
    expect(rows).toHaveLength(2);
    expect(rows[0].entity).toBe('organization');
    // now - cursor(10:00) = 1h, even though lastSuccessAt is fresh (11:00 → would be 0)
    expect(rows[0].lagMs).toBe(60 * 60 * 1000);
    expect(rows[0].lastSuccessAt).toEqual(new Date('2026-05-22T11:00:00Z'));
    expect(rows[0].successCount24h).toBe(12);
    expect(rows[0].errorCount24h).toBe(1);
  });

  it('returns lagMs = null when the cursor has never been set', async () => {
    const rows = await getSyncLag({} as never, new Date());
    const order = rows.find((r) => r.entity === 'order')!;
    expect(order.lagMs).toBeNull();
    expect(order.lastSuccessAt).toBeNull();
  });
});
