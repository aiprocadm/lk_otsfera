import { describe, it, expect, vi } from 'vitest';
const { parseWorkbook } = vi.hoisted(() => ({ parseWorkbook: vi.fn() }));
vi.mock('@/lib/services/import/parse-workbook', () => ({ parseWorkbook }));

import { previewImport } from '@/lib/services/import';

describe('previewImport', () => {
  it('rejects non-staff roles', async () => {
    const res = await previewImport({} as any, { role: 'partner' } as any, { fileBuffer: Buffer.from('') });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns a plan for a leader with a stubbed workbook', async () => {
    parseWorkbook.mockResolvedValue({
      orgs: [{ name: 'A', inn: '7700', partnerInn: null }],
      orders: [],
      payments: [{ externalId: 'PP-1', orgInn: '7700', amount: 1000, paidAt: '2026-04-20T10:00:00Z', method: null, isRefund: false, note: null }],
    });
    const prisma = { organization: { findMany: vi.fn().mockResolvedValue([]) }, partner: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    const res = await previewImport(prisma, { sub: 'u1', role: 'manager', managerRole: 'leader' } as any, { fileBuffer: Buffer.from('x') });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.plan.counts.orgsCreated).toBe(1);
      expect(res.plan.counts.paymentsUpserted).toBe(1);
    }
  });
});
