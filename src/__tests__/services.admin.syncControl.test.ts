import { describe, it, expect, vi } from 'vitest';
import { rewindCursor, triggerSync, type SyncControlQueueProvider } from '@/lib/services/admin/syncControl';

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
