import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';

let prisma: PrismaClient;

beforeAll(async () => {
  process.env.ONE_C_CURSOR_OVERLAP_MINUTES = '5';
  prisma = new PrismaClient();
  await prisma.syncState.deleteMany({});
});
afterAll(async () => {
  await prisma.syncState.deleteMany({});
  delete process.env.ONE_C_CURSOR_OVERLAP_MINUTES;
  await prisma.$disconnect();
});

describe('cursor persistence', () => {
  it('getCursor returns empty before any run', async () => {
    expect(await getCursor(prisma, 'order')).toEqual({});
  });

  it('advanceCursor stores max-updatedAt minus overlap; getCursor reads it back', async () => {
    await advanceCursor(prisma, 'order', new Date('2026-05-12T10:00:00.000Z'));
    expect(await getCursor(prisma, 'order')).toEqual({ since: '2026-05-12T09:55:00.000Z' });
  });

  it('advanceCursor with null does not move the cursor', async () => {
    await advanceCursor(prisma, 'order', null);
    expect(await getCursor(prisma, 'order')).toEqual({ since: '2026-05-12T09:55:00.000Z' });
  });

  it('markCursorError records lastError without touching cursor', async () => {
    await markCursorError(prisma, 'order', 'boom');
    const row = await prisma.syncState.findUnique({ where: { entity: 'order' } });
    expect(row?.lastError).toBe('boom');
    expect(row?.cursor).toBe('2026-05-12T09:55:00.000Z');
  });
});
