import { describe, it, expect, vi } from 'vitest';
import { SYNC_ENTITIES, rewindCursor, triggerSync, setSchedulePaused, type SyncControlQueueProvider } from '@/lib/services/admin/syncControl';
import { SYNC_SCHEDULES, CERT_EXPIRY_SCHEDULES, COMMISSION_SCHEDULES } from '@/lib/jobs/scheduling';

function txPrisma(existingCursor: string | null) {
  const findUnique = vi.fn().mockResolvedValue(existingCursor === undefined ? null : { cursor: existingCursor });
  const upsert = vi.fn().mockResolvedValue({});
  const create = vi.fn().mockResolvedValue({});
  const tx = { syncState: { findUnique, upsert }, auditLog: { create } };
  const prisma = { $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  return { prisma: prisma as never, findUnique, upsert, create };
}

describe('rewindCursor', () => {
  it('rejects an unknown entity', async () => {
    const { prisma } = txPrisma(null);
    expect(await rewindCursor(prisma, 'u1', 'nope', null)).toEqual({ ok: false, error: 'unknown_entity' });
  });

  it('rejects reconcile (no cursor)', async () => {
    const { prisma } = txPrisma(null);
    expect(await rewindCursor(prisma, 'u1', 'reconcile', '2026-06-01T00:00:00.000Z'))
      .toEqual({ ok: false, error: 'unknown_entity' });
  });

  it('rejects a future timestamp', async () => {
    const { prisma } = txPrisma(null);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(await rewindCursor(prisma, 'u1', 'order', future)).toEqual({ ok: false, error: 'invalid_cursor' });
  });

  it('rejects an unparseable timestamp', async () => {
    const { prisma } = txPrisma(null);
    expect(await rewindCursor(prisma, 'u1', 'order', 'not-a-date')).toEqual({ ok: false, error: 'invalid_cursor' });
  });

  it('upserts cursor and writes before/after audit atomically', async () => {
    const { prisma, upsert, create } = txPrisma('2026-06-05T00:00:00.000Z');
    const res = await rewindCursor(prisma, 'u1', 'order', '2026-06-01T00:00:00.000Z');
    expect(res).toEqual({ ok: true, entity: 'order', cursor: '2026-06-01T00:00:00.000Z' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { entity: 'order' },
      update: { cursor: '2026-06-01T00:00:00.000Z' },
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entity: 'sync_state',
        entityId: 'order',
        meta: expect.objectContaining({
          before: { cursor: '2026-06-05T00:00:00.000Z' },
          after: { cursor: '2026-06-01T00:00:00.000Z' },
        }),
      }),
    }));
  });

  it('accepts null (full reset)', async () => {
    const { prisma, upsert } = txPrisma('2026-06-05T00:00:00.000Z');
    const res = await rewindCursor(prisma, 'u1', 'document', null);
    expect(res).toEqual({ ok: true, entity: 'document', cursor: null });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { cursor: null } }));
  });

  it('returns storage on transaction failure', async () => {
    const prisma = { $transaction: vi.fn().mockRejectedValue(new Error('db down')) } as never;
    expect(await rewindCursor(prisma, 'u1', 'order', null)).toEqual({ ok: false, error: 'storage' });
  });
});

function auditPrisma() {
  const create = vi.fn().mockResolvedValue({});
  return { prisma: { auditLog: { create } } as never, create };
}

describe('triggerSync', () => {
  it('rejects an unknown entity', async () => {
    const { prisma } = auditPrisma();
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() }) as never;
    expect(await triggerSync(prisma, 'u1', 'nope', provider)).toEqual({ ok: false, error: 'unknown_entity' });
  });

  it('refuses when a run is already active', async () => {
    const { prisma } = auditPrisma();
    const provider: SyncControlQueueProvider = () => ({
      getJobCounts: vi.fn().mockResolvedValue({ active: 1 }),
      add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(),
    }) as never;
    expect(await triggerSync(prisma, 'u1', 'order', provider)).toEqual({ ok: false, error: 'already_running' });
  });

  it('enqueues a manual job and audits on success', async () => {
    const { prisma, create } = auditPrisma();
    const add = vi.fn().mockResolvedValue({ id: 'j1' });
    const provider: SyncControlQueueProvider = () => ({
      getJobCounts: vi.fn().mockResolvedValue({ active: 0 }),
      add, upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(),
    }) as never;
    const res = await triggerSync(prisma, 'u1', 'order', provider);
    expect(res.ok).toBe(true);
    expect(add).toHaveBeenCalledWith('manual', expect.objectContaining({ reason: 'manual' }), expect.objectContaining({ jobId: expect.stringMatching(/^manual:order:\d+$/) }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entity: 'sync_state', action: 'sync_triggered' }) }));
  });

  it('returns queue_unavailable when the queue throws', async () => {
    const { prisma } = auditPrisma();
    const provider: SyncControlQueueProvider = () => ({
      getJobCounts: vi.fn().mockRejectedValue(new Error('redis down')),
      add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(),
    }) as never;
    expect(await triggerSync(prisma, 'u1', 'order', provider)).toEqual({ ok: false, error: 'queue_unavailable' });
  });
});

// G3: run-now для standalone cron-джобов (не 1С-синк).
describe('triggerSync — background cron jobs (G3)', () => {
  it.each([
    ['certificateExpiry', 'notifications.certificateExpiry'],
    ['emailPoll', 'inbound.email.poll'],
    ['mangoBackfill', 'telephony.mango.backfill'],
    ['monthlyCommissions', 'docs.calculateMonthlyCommissions'],
  ] as const)('enqueues %s into %s with a manual jobId and audits', async (entity, queueName) => {
    const { prisma, create } = auditPrisma();
    const add = vi.fn().mockResolvedValue({ id: 'j1' });
    const provider = vi.fn(() => ({
      getJobCounts: vi.fn().mockResolvedValue({ active: 0 }),
      add, upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(),
    })) as unknown as SyncControlQueueProvider;
    const res = await triggerSync(prisma, 'u1', entity, provider);
    expect(res.ok).toBe(true);
    expect(provider).toHaveBeenCalledWith(queueName);
    expect(add).toHaveBeenCalledWith(
      'manual',
      expect.objectContaining({ reason: 'manual', triggeredAt: expect.any(String) }),
      expect.objectContaining({ jobId: expect.stringMatching(new RegExp(`^manual:${entity}:\\d+$`)) }),
    );
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'sync_triggered', entityId: entity }),
    }));
  });

  it('already_running guard applies to background jobs too', async () => {
    const { prisma } = auditPrisma();
    const add = vi.fn();
    const provider: SyncControlQueueProvider = () => ({
      getJobCounts: vi.fn().mockResolvedValue({ active: 1 }),
      add, upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(),
    }) as never;
    expect(await triggerSync(prisma, 'u1', 'emailPoll', provider)).toEqual({ ok: false, error: 'already_running' });
    expect(add).not.toHaveBeenCalled();
  });

  it.each([['certificateExpiry'], ['emailPoll'], ['mangoBackfill'], ['monthlyCommissions']])(
    'rewindCursor rejects %s (hasCursor=false)',
    async (entity) => {
      const { prisma } = txPrisma(null);
      expect(await rewindCursor(prisma, 'u1', entity, null)).toEqual({ ok: false, error: 'unknown_entity' });
    },
  );

  it('cronLabel/queueName match the schedule registries for every scheduled entity (drift guard)', () => {
    const all = [...SYNC_SCHEDULES, ...CERT_EXPIRY_SCHEDULES, ...COMMISSION_SCHEDULES];
    for (const [entity, cfg] of Object.entries(SYNC_ENTITIES)) {
      const schedule = all.find((s) => s.schedulerId === cfg.schedulerId);
      expect(schedule, `schedule registry entry for ${entity}`).toBeDefined();
      expect(cfg.cronLabel, `cronLabel of ${entity}`).toBe(schedule!.pattern);
      expect(cfg.queueName, `queueName of ${entity}`).toBe(schedule!.queueName);
    }
  });
});

function pausePrisma() {
  const upsert = vi.fn().mockResolvedValue({});
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const create = vi.fn().mockResolvedValue({});
  const prisma = { syncSchedulePause: { upsert, deleteMany }, auditLog: { create } } as never;
  return { prisma, upsert, deleteMany, create };
}

describe('setSchedulePaused', () => {
  it('rejects an unknown schedulerId', async () => {
    const { prisma } = pausePrisma();
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() }) as never;
    expect(await setSchedulePaused(prisma, 'u1', 'bogus.cron', true, provider)).toEqual({ ok: false, error: 'unknown_schedule' });
  });

  it('pause: writes DB row then removes the live scheduler', async () => {
    const { prisma, upsert } = pausePrisma();
    const removeJobScheduler = vi.fn().mockResolvedValue(true);
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler }) as never;
    const res = await setSchedulePaused(prisma, 'u1', 'oneCSync.pullOrders.cron', true, provider);
    expect(res).toEqual({ ok: true, paused: true });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { schedulerId: 'oneCSync.pullOrders.cron' } }));
    expect(removeJobScheduler).toHaveBeenCalledWith('oneCSync.pullOrders.cron');
  });

  it('resume: deletes DB row then re-registers the scheduler', async () => {
    const { prisma, deleteMany } = pausePrisma();
    const upsertJobScheduler = vi.fn().mockResolvedValue({ id: 'x' });
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler, removeJobScheduler: vi.fn() }) as never;
    const res = await setSchedulePaused(prisma, 'u1', 'oneCSync.pullOrders.cron', false, provider);
    expect(res).toEqual({ ok: true, paused: false });
    expect(deleteMany).toHaveBeenCalledWith({ where: { schedulerId: 'oneCSync.pullOrders.cron' } });
    expect(upsertJobScheduler).toHaveBeenCalledWith('oneCSync.pullOrders.cron', expect.objectContaining({ tz: 'Europe/Moscow' }), expect.anything());
  });

  it('returns queue_unavailable when the scheduler op throws (DB intent kept)', async () => {
    const { prisma } = pausePrisma();
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn().mockRejectedValue(new Error('redis down')) }) as never;
    expect(await setSchedulePaused(prisma, 'u1', 'oneCSync.pullOrders.cron', true, provider)).toEqual({ ok: false, error: 'queue_unavailable' });
  });

  // G3: реестр пауз — SYNC_SCHEDULES (ключ — schedulerId), он развязан с
  // SYNC_ENTITIES. Расширение реестра run-now паузу НЕ открывает: standalone
  // schedulerId'ы (certExpiry, commissions) и entity-ключи отвергаются.
  it.each([['notifications.certificateExpiry.cron'], ['docs.calculateMonthlyCommissions.cron']])(
    'refuses to pause background scheduler %s (not in SYNC_SCHEDULES)',
    async (schedulerId) => {
      const { prisma, upsert } = pausePrisma();
      const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() }) as never;
      expect(await setSchedulePaused(prisma, 'u1', schedulerId, true, provider)).toEqual({ ok: false, error: 'unknown_schedule' });
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it.each([['certificateExpiry'], ['emailPoll'], ['mangoBackfill'], ['monthlyCommissions']])(
    'refuses SYNC_ENTITIES key %s as a schedulerId',
    async (entityKey) => {
      const { prisma, upsert } = pausePrisma();
      const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() }) as never;
      expect(await setSchedulePaused(prisma, 'u1', entityKey, true, provider)).toEqual({ ok: false, error: 'unknown_schedule' });
      expect(upsert).not.toHaveBeenCalled();
    },
  );
});
