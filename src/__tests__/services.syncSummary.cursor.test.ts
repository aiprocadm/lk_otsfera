import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getSyncSummary } from '@/lib/services/syncSummary';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.syncState.deleteMany({});
});
afterAll(async () => {
  await prisma.syncState.deleteMany({});
  await prisma.$disconnect();
});

describe('getSyncSummary cursor + lag', () => {
  it('exposes cursor and lagMs per entity (null when no SyncState row)', async () => {
    const before = await getSyncSummary(prisma);
    const orderBefore = before.find((r) => r.entity === 'order')!;
    expect(orderBefore.cursor).toBeNull();
    expect(orderBefore.lagMs).toBeNull();

    await prisma.syncState.create({ data: { entity: 'order', cursor: '2026-05-01T00:00:00.000Z' } });

    const after = await getSyncSummary(prisma);
    const orderAfter = after.find((r) => r.entity === 'order')!;
    expect(orderAfter.cursor).toBe('2026-05-01T00:00:00.000Z');
    expect(orderAfter.lagMs).toBeGreaterThan(0);
  });
});
