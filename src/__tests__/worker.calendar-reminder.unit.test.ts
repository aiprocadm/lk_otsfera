/**
 * M5 — unit-тесты runCalendarReminders (спека 2026-07-17-m5-calendar §5).
 * Mock-prisma; @/lib/notifications и @/lib/logging замоканы. Обёртка
 * calendarReminderProcessor тянет @/lib/db/prisma динамически — он тоже замокан
 * (пустая выборка), чтобы проверить саму склейку воркера.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { createNotificationMock, deliverNotificationToUserMock, logErrorMock } = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  deliverNotificationToUserMock: vi.fn(),
  logErrorMock: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({
  createNotification: createNotificationMock,
  deliverNotificationToUser: deliverNotificationToUserMock,
}));
vi.mock('@/lib/logging', () => ({ log: { error: logErrorMock } }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { calendarEvent: { findMany: vi.fn().mockResolvedValue([]) } },
}));

import {
  runCalendarReminders,
  calendarReminderProcessor,
} from '@/worker/processors/calendar-reminder';

const NOW = new Date('2026-07-17T12:00:00.000Z');

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    title: 'Планёрка',
    startsAt: new Date('2026-07-17T12:15:00.000Z'),
    remindAt: new Date('2026-07-17T11:55:00.000Z'),
    location: null,
    createdById: 'u1',
    attendees: [] as { userId: string }[],
    ...over,
  };
}

function makePrisma(candidates: unknown[], claimCount = 1) {
  const findMany = vi.fn().mockResolvedValue(candidates);
  const updateMany = vi.fn().mockResolvedValue({ count: claimCount });
  const prisma = { calendarEvent: { findMany, updateMany } } as unknown as PrismaClient;
  return { prisma, findMany, updateMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationMock.mockImplementation(async ({ userId }: { userId: string }) => ({
    id: `n-${userId}`,
  }));
  deliverNotificationToUserMock.mockResolvedValue(undefined);
});

describe('runCalendarReminders', () => {
  it('без кандидатов → нули, updateMany не вызывается', async () => {
    const { prisma, findMany, updateMany } = makePrisma([]);
    expect(await runCalendarReminders(prisma, NOW)).toEqual({ remindersSent: 0, stale: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { remindAt: { not: null, lte: NOW }, reminderSentAt: null },
      })
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('happy path: уведомления создателю и участникам, получатели дедуплицированы', async () => {
    const { prisma, updateMany } = makePrisma([
      candidate({
        location: 'Переговорка',
        attendees: [{ userId: 'u1' }, { userId: 'u2' }], // u1 = создатель → дедуп
      }),
    ]);
    const res = await runCalendarReminders(prisma, NOW);
    expect(res).toEqual({ remindersSent: 1, stale: 0 });
    // атомарный claim
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', reminderSentAt: null },
      data: { reminderSentAt: NOW },
    });
    // ровно два получателя: u1 (создатель∩участник — один раз) и u2
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock.mock.calls.map((c) => c[0].userId)).toEqual(['u1', 'u2']);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: 'u1',
      type: 'calendar_event_reminder',
      title: 'Напоминание о событии',
      body: expect.stringContaining('«Планёрка» — '),
      meta: { calendarEventId: 'e1' },
    });
    // локация попадает в текст
    expect(createNotificationMock.mock.calls[0][0].body).toContain(', Переговорка');
    // доставка с dedupKey = id строки Notification
    expect(deliverNotificationToUserMock).toHaveBeenCalledTimes(2);
    expect(deliverNotificationToUserMock).toHaveBeenCalledWith({
      userId: 'u2',
      title: 'Напоминание о событии',
      body: expect.stringContaining('«Планёрка»'),
      type: 'calendar_event_reminder',
      url: '/manager/calendar',
      dedupKey: 'n-u2',
    });
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('без локации хвост «, локация» не добавляется', async () => {
    const { prisma } = makePrisma([candidate()]);
    await runCalendarReminders(prisma, NOW);
    const when = new Date('2026-07-17T12:15:00.000Z').toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow',
    });
    expect(createNotificationMock.mock.calls[0][0].body).toBe(`«Планёрка» — ${when}`);
  });

  it('claim count 0 (другой воркер забрал) → пропуск без уведомлений', async () => {
    const { prisma } = makePrisma([candidate()], 0);
    expect(await runCalendarReminders(prisma, NOW)).toEqual({ remindersSent: 0, stale: 0 });
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(deliverNotificationToUserMock).not.toHaveBeenCalled();
  });

  it('протухшее (>24ч) — помечается claim-ом, но без уведомлений', async () => {
    const { prisma, updateMany } = makePrisma([
      candidate({ remindAt: new Date('2026-07-16T11:00:00.000Z') }), // 25 часов назад
    ]);
    expect(await runCalendarReminders(prisma, NOW)).toEqual({ remindersSent: 0, stale: 1 });
    expect(updateMany).toHaveBeenCalledTimes(1); // помечено reminderSentAt
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('ровно 24ч лага — ещё не протухшее', async () => {
    const { prisma } = makePrisma([candidate({ remindAt: new Date('2026-07-16T12:00:00.000Z') })]);
    expect(await runCalendarReminders(prisma, NOW)).toEqual({ remindersSent: 1, stale: 0 });
  });

  it('сбой доставки одному получателю: лог + продолжение, счётчик не ломается', async () => {
    createNotificationMock.mockImplementation(async ({ userId }: { userId: string }) => {
      if (userId === 'u1') throw new Error('smtp down');
      return { id: `n-${userId}` };
    });
    const { prisma } = makePrisma([candidate({ attendees: [{ userId: 'u2' }] })]);
    const res = await runCalendarReminders(prisma, NOW);
    expect(res).toEqual({ remindersSent: 1, stale: 0 });
    expect(logErrorMock).toHaveBeenCalledWith('[calendar-reminder] delivery failed', {
      err: expect.any(Error),
      calendarEventId: 'e1',
      userId: 'u1',
    });
    // второй получатель всё равно получил
    expect(deliverNotificationToUserMock).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2', dedupKey: 'n-u2' })
    );
  });

  it('сбой на этапе deliver тоже best-effort', async () => {
    deliverNotificationToUserMock.mockRejectedValueOnce(new Error('push down'));
    const { prisma } = makePrisma([candidate()]);
    expect(await runCalendarReminders(prisma, NOW)).toEqual({ remindersSent: 1, stale: 0 });
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it('несколько кандидатов обрабатываются независимо', async () => {
    const { prisma } = makePrisma([
      candidate(),
      candidate({
        id: 'e2',
        title: 'Демо',
        createdById: 'u3',
        remindAt: new Date('2026-07-15T10:00:00.000Z'),
      }),
    ]);
    expect(await runCalendarReminders(prisma, NOW)).toEqual({ remindersSent: 1, stale: 1 });
  });
});

describe('calendarReminderProcessor (обёртка BullMQ)', () => {
  it('работает на глобальном prisma и текущем времени', async () => {
    // Обёртка — единственное место, где воркер соединяется с настоящей базой.
    // Если она сломается, напоминания просто перестанут приходить, и никакой
    // тест самой логики этого не заметит.
    expect(await calendarReminderProcessor()).toEqual({ remindersSent: 0, stale: 0 });
  });
});
