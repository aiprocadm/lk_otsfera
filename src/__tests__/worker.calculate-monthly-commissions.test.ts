import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { SyncJobPayload } from '@/lib/jobs/types';

// Mock calculateStatementForPartner before importing processor
vi.mock('@/lib/services/commission/statement', () => ({
  calculateStatementForPartner: vi.fn()
}));

// Mock default prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {}
}));

import { calculateMonthlyCommissionsProcessor } from '@/worker/processors/calculate-monthly-commissions';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';

const mockCalc = calculateStatementForPartner as ReturnType<typeof vi.fn>;

function makeJob(id = 'job-1'): Job<SyncJobPayload> {
  return { id, data: { triggeredAt: new Date().toISOString(), reason: 'cron' } } as Job<SyncJobPayload>;
}

function makePrisma(partners: { id: string }[]) {
  return {
    partner: {
      findMany: vi.fn().mockResolvedValue(partners)
    }
  } as any;
}

beforeEach(() => {
  mockCalc.mockReset();
});

describe('calculateMonthlyCommissionsProcessor', () => {
  it('processes partners with commissionRate > 0', async () => {
    const db = makePrisma([{ id: 'p1' }, { id: 'p2' }]);
    mockCalc.mockResolvedValue({ statement: {}, itemCount: 5, isNew: true });

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(mockCalc).toHaveBeenCalledTimes(2);
    expect(result.partnersProcessed).toBe(2);
    expect(result.partnersSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('skips partner when itemCount=0 (no qualifying orders)', async () => {
    const db = makePrisma([{ id: 'p1' }, { id: 'p2' }]);
    mockCalc
      .mockResolvedValueOnce({ statement: {}, itemCount: 3, isNew: true })
      .mockResolvedValueOnce({ statement: {}, itemCount: 0, isNew: true });

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(result.partnersProcessed).toBe(1);
    expect(result.partnersSkipped).toBe(1);
  });

  it('captures errors per partner and continues with the rest', async () => {
    const db = makePrisma([{ id: 'p1' }, { id: 'p2' }]);
    mockCalc
      .mockRejectedValueOnce(new Error('DB timeout'))
      .mockResolvedValueOnce({ statement: {}, itemCount: 2, isNew: true });

    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(result.partnersProcessed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].partnerId).toBe('p1');
    expect(result.errors[0].error).toBe('DB timeout');
  });

  it('returns periodFrom / periodTo as ISO strings', async () => {
    const db = makePrisma([]);
    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(typeof result.periodFrom).toBe('string');
    expect(typeof result.periodTo).toBe('string');
    // prev month: from should be the 1st of prev month
    const from = new Date(result.periodFrom);
    expect(from.getDate()).toBe(1);
  });

  it('passes calculatedByUserId=null to calculateStatementForPartner', async () => {
    const db = makePrisma([{ id: 'p1' }]);
    mockCalc.mockResolvedValue({ statement: {}, itemCount: 1, isNew: true });

    await calculateMonthlyCommissionsProcessor(makeJob(), db);

    expect(mockCalc).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ partnerId: 'p1', calculatedByUserId: null })
    );
  });
});
