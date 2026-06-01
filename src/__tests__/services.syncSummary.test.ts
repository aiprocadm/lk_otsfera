import { describe, expect, it, vi } from 'vitest';
import { getSyncSummary } from '@/lib/services/syncSummary';
import type { PrismaClient } from '@prisma/client';

type CountInput = { where: { entity: string; status: string } };
type FindFirstInput = { where: { entity: string; status: string }; orderBy?: unknown; select?: unknown };
type FindUniqueInput = { where: { entity: string }; select?: unknown };

function makePrismaMock(opts: {
  countsByEntityStatus?: Record<string, number>;
  lastSuccessByEntity?: Record<string, Date | null>;
  lastErrorByEntity?: Record<string, { createdAt: Date; errorMessage: string | null } | null>;
  cursorByEntity?: Record<string, string | null>;
}): PrismaClient {
  const countsByEntityStatus = opts.countsByEntityStatus ?? {};
  const lastSuccessByEntity = opts.lastSuccessByEntity ?? {};
  const lastErrorByEntity = opts.lastErrorByEntity ?? {};
  const cursorByEntity = opts.cursorByEntity ?? {};

  return {
    syncLog: {
      count: vi.fn(async (input: CountInput) => {
        const key = `${input.where.entity}:${input.where.status}`;
        return countsByEntityStatus[key] ?? 0;
      }),
      findFirst: vi.fn(async (input: FindFirstInput) => {
        if (input.where.status === 'success') {
          const at = lastSuccessByEntity[input.where.entity];
          return at ? { createdAt: at } : null;
        }
        if (input.where.status === 'error') {
          const e = lastErrorByEntity[input.where.entity];
          return e ?? null;
        }
        return null;
      })
    },
    syncState: {
      findUnique: vi.fn(async (input: FindUniqueInput) => {
        const c = cursorByEntity[input.where.entity];
        return c !== undefined ? { cursor: c } : null;
      })
    }
  } as unknown as PrismaClient;
}

describe('getSyncSummary', () => {
  it('returns rows for all 4 tracked entities even when empty', async () => {
    const prisma = makePrismaMock({});
    const rows = await getSyncSummary(prisma);
    const entities = rows.map((r) => r.entity).sort();
    expect(entities).toEqual(['document', 'order', 'organization', 'payment']);
    for (const r of rows) {
      expect(r.successCount24h).toBe(0);
      expect(r.warnCount24h).toBe(0);
      expect(r.errorCount24h).toBe(0);
      expect(r.lastSuccessAt).toBeNull();
      expect(r.lastErrorAt).toBeNull();
      expect(r.lastErrorMessage).toBeNull();
      expect(r.cursor).toBeNull();
      expect(r.lagMs).toBeNull();
    }
  });

  it('aggregates counts by status per entity', async () => {
    const prisma = makePrismaMock({
      countsByEntityStatus: {
        'order:success': 12,
        'order:warn': 3,
        'order:error': 1,
        'payment:success': 8
      }
    });
    const rows = await getSyncSummary(prisma);
    const order = rows.find((r) => r.entity === 'order')!;
    const payment = rows.find((r) => r.entity === 'payment')!;
    expect(order.successCount24h).toBe(12);
    expect(order.warnCount24h).toBe(3);
    expect(order.errorCount24h).toBe(1);
    expect(payment.successCount24h).toBe(8);
    expect(payment.warnCount24h).toBe(0);
  });

  it('returns lastSuccessAt and lastError details correctly', async () => {
    const lastSuccess = new Date('2026-05-22T08:00:00Z');
    const lastError = new Date('2026-05-22T06:30:00Z');
    const prisma = makePrismaMock({
      lastSuccessByEntity: { organization: lastSuccess },
      lastErrorByEntity: {
        organization: { createdAt: lastError, errorMessage: 'timeout calling 1C' }
      }
    });
    const rows = await getSyncSummary(prisma);
    const org = rows.find((r) => r.entity === 'organization')!;
    expect(org.lastSuccessAt).toEqual(lastSuccess);
    expect(org.lastErrorAt).toEqual(lastError);
    expect(org.lastErrorMessage).toBe('timeout calling 1C');
  });

  it('exposes cursor and positive lagMs when SyncState has a cursor', async () => {
    const prisma = makePrismaMock({
      cursorByEntity: { order: '2026-05-01T00:00:00.000Z' }
    });
    const rows = await getSyncSummary(prisma);
    const order = rows.find((r) => r.entity === 'order')!;
    expect(order.cursor).toBe('2026-05-01T00:00:00.000Z');
    expect(order.lagMs).toBeGreaterThan(0);
    const org = rows.find((r) => r.entity === 'organization')!;
    expect(org.cursor).toBeNull();
    expect(org.lagMs).toBeNull();
  });
});
