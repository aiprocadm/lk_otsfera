import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerTaskRecurrenceSchedules,
  registerDigestSchedules,
  registerSyncSchedules,
  loadPausedSchedulerIds,
  defaultPatternFor,
  SYNC_SCHEDULES,
} from '@/lib/jobs/scheduling';

/**
 * Регистрация повторяющихся задач и почасового дайджеста.
 *
 * Регистрация идёт через `upsertJobScheduler`, а не «добавить задачу»: при
 * каждом старте воркера расписание должно **перезаписываться**, а не
 * плодиться. Иначе после пяти перезапусков одно и то же напоминание уходит
 * человеку пять раз.
 */
function fakeQueues() {
  const calls: Array<{ queue: string; id: string; opts: unknown; data: unknown }> = [];
  const getQueue = vi.fn((name: string) => ({
    upsertJobScheduler: vi.fn(async (id: string, opts: unknown, payload: { data: unknown }) => {
      calls.push({ queue: name, id, opts, data: payload.data });
    }),
  }));
  return { getQueue: getQueue as never, calls };
}

beforeEach(() => vi.clearAllMocks());

describe('registerTaskRecurrenceSchedules — повторяющиеся задачи', () => {
  it('расписание перезаписывается, а не добавляется заново', async () => {
    const { getQueue, calls } = fakeQueues();

    const res = await registerTaskRecurrenceSchedules(getQueue);

    expect(res).toEqual([
      {
        schedulerId: 'tasks.recurrence.cron',
        queueName: 'tasks.recurrence',
        pattern: '0 6 * * *',
        tz: expect.any(String),
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.queue).toBe('tasks.recurrence');
    expect(calls[0]?.id).toBe('tasks.recurrence.cron');
  });

  it('в задачу кладётся отметка времени и причина запуска', async () => {
    const { getQueue, calls } = fakeQueues();

    await registerTaskRecurrenceSchedules(getQueue);

    expect(calls[0]?.data).toMatchObject({ reason: 'cron' });
    expect(typeof (calls[0]?.data as { triggeredAt: string }).triggeredAt).toBe('string');
  });
});

describe('registerDigestSchedules — почасовой дайджест', () => {
  it('регистрируется ежечасно и в свою очередь', async () => {
    const { getQueue, calls } = fakeQueues();

    const res = await registerDigestSchedules(getQueue);

    expect(res[0]).toMatchObject({ queueName: 'notifications.digest', pattern: '0 * * * *' });
    expect(calls[0]?.opts).toMatchObject({ pattern: '0 * * * *' });
  });
});

describe('defaultPatternFor — расписание по умолчанию', () => {
  it('для известной задачи возвращает её выражение', () => {
    expect(defaultPatternFor('tasks.recurrence.cron')).toBe('0 6 * * *');
    expect(defaultPatternFor('notifications.digest.cron')).not.toBeNull();
  });

  it('для незнакомой задачи — «такой нет», а не выдуманное расписание', () => {
    expect(defaultPatternFor('придуманная.задача')).toBeNull();
  });
});

describe('registerSyncSchedules — пауза и своё расписание', () => {
  it('поставленное на паузу расписание не регистрируется вовсе', async () => {
    const { getQueue, calls } = fakeQueues();
    const paused = new Set(SYNC_SCHEDULES.map((s) => s.schedulerId));

    const res = await registerSyncSchedules(getQueue, paused);

    // Пауза означает «не запускать», а не «запускать реже»: задачи в
    // расписании быть не должно совсем.
    expect(res).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('заданное из интерфейса расписание перекрывает умолчание из кода', async () => {
    const { getQueue, calls } = fakeQueues();
    const first = SYNC_SCHEDULES[0]!;

    const res = await registerSyncSchedules(
      getQueue,
      new Set(),
      new Map([[first.schedulerId, '*/7 * * * *']])
    );

    expect(res[0]).toMatchObject({ schedulerId: first.schedulerId, pattern: '*/7 * * * *' });
    expect(calls[0]?.opts).toMatchObject({ pattern: '*/7 * * * *' });
  });
});

describe('loadPausedSchedulerIds — какие задачи на паузе', () => {
  it('читает список из базы и отдаёт набором', async () => {
    const prisma = {
      syncSchedulePause: {
        findMany: vi.fn(async () => [{ schedulerId: 'a' }, { schedulerId: 'b' }]),
      },
    } as never;

    await expect(loadPausedSchedulerIds(prisma)).resolves.toEqual(new Set(['a', 'b']));
  });
});
