import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { rewindCursor, setSchedulePaused } from '@/lib/services/admin/syncControl';
import { loadPausedSchedulerIds } from '@/lib/jobs/scheduling';

const prisma = new PrismaClient();
const ENTITY = 'order';
const SCHED = 'oneCSync.pullOrders.cron';
const ACTOR = 'integration-admin';

// Provider stub: pause must not require live Redis in this test.
const noopProvider = () =>
  ({ getJobCounts: async () => ({}), add: async () => ({}), upsertJobScheduler: async () => ({}), removeJobScheduler: async () => true }) as never;

beforeAll(async () => {
  // Self-seed the actor user: AuditLog.userId is an FK to User, and rewindCursor
  // writes a SyncState + audit atomically in one transaction — a missing actor
  // makes the audit insert fail (P2003) and rolls back the whole rewind. The test
  // must own its fixture rather than rely on accumulated dev-DB state.
  await prisma.user.upsert({
    where: { id: ACTOR },
    update: {},
    create: { id: ACTOR, email: `${ACTOR}@synccontrol.test`, name: 'Sync Control Integration Admin', role: 'admin' },
  });
  await prisma.syncSchedulePause.deleteMany({ where: { schedulerId: SCHED } });
});

afterAll(async () => {
  await prisma.syncSchedulePause.deleteMany({ where: { schedulerId: SCHED } });
  await prisma.auditLog.deleteMany({ where: { userId: ACTOR } });
  await prisma.user.deleteMany({ where: { id: ACTOR } });
  await prisma.$disconnect();
});

describe('rewindCursor (integration)', () => {
  it('writes SyncState.cursor and an audit row atomically', async () => {
    const res = await rewindCursor(prisma, ACTOR, ENTITY, '2026-06-01T00:00:00.000Z');
    expect(res).toEqual({ ok: true, entity: ENTITY, cursor: '2026-06-01T00:00:00.000Z' });

    const state = await prisma.syncState.findUnique({ where: { entity: ENTITY } });
    expect(state?.cursor).toBe('2026-06-01T00:00:00.000Z');

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'sync_state', entityId: ENTITY, action: 'cursor_rewound' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });
});

describe('setSchedulePaused (integration)', () => {
  it('pause creates a row that loadPausedSchedulerIds reads back; resume removes it', async () => {
    const pause = await setSchedulePaused(prisma, ACTOR, SCHED, true, noopProvider);
    expect(pause).toEqual({ ok: true, paused: true });
    expect(await loadPausedSchedulerIds(prisma)).toContain(SCHED);

    const resume = await setSchedulePaused(prisma, ACTOR, SCHED, false, noopProvider);
    expect(resume).toEqual({ ok: true, paused: false });
    expect(await loadPausedSchedulerIds(prisma)).not.toContain(SCHED);
  });

  // G3: standalone cron-джобы (certExpiry, monthlyCommissions) не входят в
  // SYNC_SCHEDULES — пауза для них отвергается ещё до записи в БД.
  it.each([['notifications.certificateExpiry.cron'], ['docs.calculateMonthlyCommissions.cron']])(
    'refuses to pause background scheduler %s and writes no pause row',
    async (schedulerId) => {
      const res = await setSchedulePaused(prisma, ACTOR, schedulerId, true, noopProvider);
      expect(res).toEqual({ ok: false, error: 'unknown_schedule' });
      expect(await loadPausedSchedulerIds(prisma)).not.toContain(schedulerId);
    },
  );
});
