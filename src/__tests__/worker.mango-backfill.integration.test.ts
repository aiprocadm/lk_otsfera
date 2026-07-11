import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';

const { requestStats, fetchStatsResult } = vi.hoisted(() => ({
  requestStats: vi.fn(),
  fetchStatsResult: vi.fn(),
}));

vi.mock('@/lib/telephony/mango', () => ({
  getMangoAdapter: () => ({ requestStats, fetchStatsResult }),
}));

import { mangoBackfillProcessor } from '@/worker/processors/mango-backfill';

const prisma = new PrismaClient();
const STAMP = `mbf${Date.now()}`;

function makeJob(): Job {
  return { id: 'job-1', data: {} } as Job;
}

function statsRow(entryId: string, callerNumber: string) {
  return {
    entry_id: entryId,
    from: { number: callerNumber },
    to: { number: '100' },
    call_direction: 1,
    duration: 42,
    status: 'completed',
  };
}

async function cleanup() {
  await prisma.call.deleteMany({ where: { externalId: { startsWith: STAMP } } });
  await prisma.syncState.deleteMany({ where: { entity: 'telephony.mango' } });
}

beforeAll(cleanup);
afterEach(() => {
  vi.clearAllMocks();
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('mangoBackfillProcessor', () => {
  it('ingests stats rows and advances the SyncState cursor', async () => {
    const now = new Date('2026-07-05T12:00:00.000Z');
    requestStats.mockResolvedValue({ key: 'stats-key-1' });
    fetchStatsResult.mockResolvedValue({
      ready: true,
      rows: [statsRow(`${STAMP}:a`, '+79990001111'), statsRow(`${STAMP}:b`, '+79990002222')],
    });

    const result = await mangoBackfillProcessor(makeJob(), prisma, now);

    expect(result).toEqual({ ingested: 2 });

    const calls = await prisma.call.findMany({ where: { externalId: { startsWith: STAMP } } });
    expect(calls).toHaveLength(2);

    const state = await prisma.syncState.findUnique({ where: { entity: 'telephony.mango' } });
    expect(state?.cursor).toBe(now.toISOString());
    expect(state?.lastRunAt?.toISOString()).toBe(now.toISOString());
    expect(state?.lastSuccessAt?.toISOString()).toBe(now.toISOString());

    // requestStats window: first run has no cursor yet, so `from` is a 24h lookback from `now`.
    expect(requestStats).toHaveBeenCalledWith({
      from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      to: now.toISOString(),
    });
  });

  it('running again with the same rows stays idempotent: still exactly 2 Call rows', async () => {
    const now2 = new Date('2026-07-05T13:00:00.000Z');
    requestStats.mockResolvedValue({ key: 'stats-key-2' });
    fetchStatsResult.mockResolvedValue({
      ready: true,
      rows: [statsRow(`${STAMP}:a`, '+79990001111'), statsRow(`${STAMP}:b`, '+79990002222')],
    });

    const result = await mangoBackfillProcessor(makeJob(), prisma, now2);

    expect(result).toEqual({ ingested: 2 });

    const calls = await prisma.call.findMany({ where: { externalId: { startsWith: STAMP } } });
    expect(calls).toHaveLength(2);

    // second run's window should start from the cursor persisted by the first run.
    expect(requestStats).toHaveBeenCalledWith({
      from: '2026-07-05T12:00:00.000Z',
      to: now2.toISOString(),
    });
  });

  it('ingest-падение одной строки логируется и не валит джобу (Error и не-Error)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nowF = new Date('2026-07-05T15:00:00.000Z');
    requestStats.mockResolvedValue({ key: 'stats-key-f' });
    fetchStatsResult.mockResolvedValue({
      ready: true,
      rows: [
        { garbage: true }, // не парсится в событие → строка пропускается (continue)
        statsRow(`${STAMP}:f1`, '+79990004444'),
        statsRow(`${STAMP}:f2`, '+79990005555'),
      ],
    });

    // db-обёртка: резолв/стейт идут в настоящую БД, а call.findUnique падает —
    // Error для первой строки, строкой для второй (обе ноги String(err)-тернарника).
    const db = {
      user: prisma.user,
      lead: prisma.lead,
      syncState: prisma.syncState,
      call: {
        findUnique: vi.fn()
          .mockRejectedValueOnce(new Error('ingest down'))
          .mockRejectedValueOnce('ingest gone'),
      },
    } as unknown as PrismaClient;

    const result = await mangoBackfillProcessor(makeJob(), db, nowF);

    expect(result).toEqual({ ingested: 2 }); // счётчик учитывает попытки (существующая семантика)
    expect(warn).toHaveBeenCalledWith('[mango-backfill] ingest failed', { error: 'ingest down' });
    expect(warn).toHaveBeenCalledWith('[mango-backfill] ingest failed', { error: 'ingest gone' });
    warn.mockRestore();
  });

  it('never becomes ready within the attempt cap: returns ingested:0 without throwing', async () => {
    const now3 = new Date('2026-07-05T14:00:00.000Z');
    requestStats.mockResolvedValue({ key: 'stats-key-3' });
    fetchStatsResult.mockResolvedValue({ ready: false, rows: [] });

    // pollDelayMs=0 — иначе тест спит 9×3с (дефолтная пауза между попытками)
    const result = await mangoBackfillProcessor(makeJob(), prisma, now3, 0);

    expect(result).toEqual({ ingested: 0 });
    expect(fetchStatsResult).toHaveBeenCalledTimes(10);

    const state = await prisma.syncState.findUnique({ where: { entity: 'telephony.mango' } });
    expect(state?.cursor).toBe(now3.toISOString());
  });

  it('reads the default poll delay from MANGO_STATS_POLL_DELAY_MS', async () => {
    process.env.MANGO_STATS_POLL_DELAY_MS = '0';
    try {
      const now5 = new Date('2026-07-05T16:00:00.000Z');
      requestStats.mockResolvedValue({ key: 'stats-key-5' });
      fetchStatsResult
        .mockResolvedValueOnce({ ready: false, rows: [] })
        .mockResolvedValueOnce({ ready: true, rows: [] });

      // 4-й аргумент опущен → дефолт из env ('0' → без паузы, тест быстрый)
      const result = await mangoBackfillProcessor(makeJob(), prisma, now5);

      expect(result).toEqual({ ingested: 0 });
      expect(fetchStatsResult).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.MANGO_STATS_POLL_DELAY_MS;
    }
  });

  it('waits pollDelayMs between attempts (R2: no busy-loop against the stats API)', async () => {
    const now4 = new Date('2026-07-05T15:00:00.000Z');
    requestStats.mockResolvedValue({ key: 'stats-key-4' });
    let firstCallAt = 0;
    let secondCallAt = 0;
    fetchStatsResult
      .mockImplementationOnce(async () => {
        firstCallAt = performance.now();
        return { ready: false, rows: [] };
      })
      .mockImplementationOnce(async () => {
        secondCallAt = performance.now();
        return { ready: true, rows: [] };
      });

    const result = await mangoBackfillProcessor(makeJob(), prisma, now4, 25);

    expect(result).toEqual({ ingested: 0 });
    expect(fetchStatsResult).toHaveBeenCalledTimes(2);
    // Между 1-й (not ready) и 2-й попыткой была пауза ≥ pollDelayMs
    expect(secondCallAt - firstCallAt).toBeGreaterThanOrEqual(20);
  });
});
