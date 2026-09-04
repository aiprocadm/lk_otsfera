import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.syncLog.deleteMany({
    where: { entity: 'order', externalId: { startsWith: 'log-test-' } },
  });
});

describe('writeSyncLog', () => {
  it('persists a success record and returns its id (У-173: пакет для 1С ссылается на запись из аудита)', async () => {
    const { id } = await writeSyncLog({
      entity: 'order',
      externalId: 'log-test-1',
      direction: 'inbound',
      operation: 'create',
      status: 'success',
      durationMs: 12,
    });
    const rows = await prisma.syncLog.findMany({
      where: { externalId: 'log-test-1' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('success');
    expect(rows[0].id).toBe(id);
  });

  it('persists an error with message and payload', async () => {
    await writeSyncLog({
      entity: 'order',
      externalId: 'log-test-2',
      direction: 'inbound',
      operation: 'update',
      status: 'error',
      errorMessage: 'boom',
      payload: { stack: 'fake' },
    });
    const row = await prisma.syncLog.findFirst({
      where: { externalId: 'log-test-2' },
    });
    expect(row?.errorMessage).toBe('boom');
    expect(row?.payload).toMatchObject({ stack: 'fake' });
  });
});
