/**
 * M5 — unit-тесты CRUD событий календаря (спека 2026-07-17-m5-calendar §3, §7).
 * Mock-prisma (без new PrismaClient), recordAudit замокан; реальные функции
 * сервиса гоняются против ручных фейков — паттерн cov.tasks.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock } = vi.hoisted(() => ({ recordAuditMock: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import {
  createEvent,
  updateEvent,
  deleteEvent,
  REMIND_MINUTES,
  type CalendarEventInput,
} from '@/lib/services/calendar/events';

const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as unknown as SessionPayload;
const managerNoCompany = {
  sub: 'm9',
  role: 'manager',
  companyId: null,
} as unknown as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as unknown as SessionPayload;
const ownLevelManager = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  accessProfile: { tasks: 'own' },
} as unknown as SessionPayload;

const FUTURE = new Date('2099-07-20T10:00:00.000Z');
const FUTURE_END = new Date('2099-07-20T11:00:00.000Z');
const PAST = new Date('2020-01-01T10:00:00.000Z');

function baseInput(over: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return { title: 'Встреча', startsAt: FUTURE, ...over };
}

type Tx = {
  calendarEvent: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  calendarEventAttendee: {
    findMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  order: { findUnique: ReturnType<typeof vi.fn> };
  organization: { findUnique: ReturnType<typeof vi.fn> };
  user: { count: ReturnType<typeof vi.fn> };
};

function makeTx(): Tx {
  return {
    calendarEvent: {
      create: vi.fn().mockResolvedValue({ id: 'e1', title: 'Встреча', startsAt: FUTURE }),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    calendarEventAttendee: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    order: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    user: { count: vi.fn() },
  };
}

function prismaFor(tx: Tx): PrismaClient {
  return {
    $transaction: vi.fn().mockImplementation((fn: (t: Tx) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
}

/** Существующая строка события для update/delete-путей. */
function existingRow(over: Record<string, unknown> = {}) {
  return {
    companyId: 'c1',
    createdById: 'm1',
    attendees: [] as { userId: string }[],
    title: 'Старое',
    remindAt: null,
    reminderSentAt: null,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('createEvent', () => {
  it('staffGate: partner → forbidden; менеджер без companyId → forbidden', async () => {
    expect(await createEvent({} as never, partner, baseInput())).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await createEvent({} as never, managerNoCompany, baseInput())).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('validation: пустой title', async () => {
    expect(await createEvent({} as never, manager, baseInput({ title: '   ' }))).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('validation: endsAt ≤ startsAt', async () => {
    expect(await createEvent({} as never, manager, baseInput({ endsAt: PAST }))).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await createEvent({} as never, manager, baseInput({ endsAt: FUTURE }))).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('validation: невалидный remindMinutes и невалидная дата', async () => {
    expect(
      await createEvent({} as never, manager, baseInput({ remindMinutes: 30 as never }))
    ).toEqual({ ok: false, error: 'validation' });
    expect(
      await createEvent({} as never, manager, baseInput({ startsAt: new Date('oops') }))
    ).toEqual({ ok: false, error: 'validation' });
  });

  it('успех: remindAt = startsAt − remindMinutes, attendees дедуплицированы, audit', async () => {
    const tx = makeTx();
    tx.user.count.mockResolvedValue(1);
    const res = await createEvent(
      prismaFor(tx),
      manager,
      baseInput({
        description: 'Обсудить план',
        location: 'Переговорка',
        endsAt: FUTURE_END,
        allDay: false,
        remindMinutes: 15,
        attendeeIds: ['u2', 'u2'],
      })
    );
    expect(res).toEqual({ ok: true, id: 'e1' });
    expect(tx.user.count).toHaveBeenCalledWith({
      // Валидация участников пускает и руководителя (ТЗ 2026-08-17).
      where: {
        id: { in: ['u2'] },
        companyId: 'c1',
        role: { in: ['admin', 'manager', 'leader'] },
      },
    });
    expect(tx.calendarEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'c1',
        createdById: 'm1',
        title: 'Встреча',
        description: 'Обсудить план',
        location: 'Переговорка',
        startsAt: FUTURE,
        endsAt: FUTURE_END,
        allDay: false,
        remindAt: new Date(FUTURE.getTime() - 15 * 60_000),
        linkedOrderId: null,
        linkedOrganizationId: null,
      }),
    });
    expect(tx.calendarEventAttendee.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 'e1', userId: 'u2' }],
    });
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        userId: 'm1',
        action: 'calendar_event_created',
        entity: 'calendar_event',
        entityId: 'e1',
      })
    );
  });

  it('успех без attendees/remind: createMany не вызывается, remindAt null, дефолты', async () => {
    const tx = makeTx();
    const res = await createEvent(prismaFor(tx), manager, baseInput({ attendeeIds: [] }));
    expect(res).toEqual({ ok: true, id: 'e1' });
    expect(tx.calendarEventAttendee.createMany).not.toHaveBeenCalled();
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(tx.calendarEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: null,
        location: null,
        endsAt: null,
        allDay: false,
        remindAt: null,
      }),
    });
  });

  it('чужой linkedOrder → validation (нет заказа / чужая компания)', async () => {
    const tx = makeTx();
    tx.order.findUnique.mockResolvedValue(null);
    expect(await createEvent(prismaFor(tx), manager, baseInput({ linkedOrderId: 'o1' }))).toEqual({
      ok: false,
      error: 'validation',
    });
    tx.order.findUnique.mockResolvedValue({ companyId: 'c2' });
    expect(await createEvent(prismaFor(tx), manager, baseInput({ linkedOrderId: 'o1' }))).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('чужая linkedOrganization → validation', async () => {
    const tx = makeTx();
    tx.organization.findUnique.mockResolvedValue(null);
    expect(
      await createEvent(prismaFor(tx), manager, baseInput({ linkedOrganizationId: 'org1' }))
    ).toEqual({ ok: false, error: 'validation' });
    tx.organization.findUnique.mockResolvedValue({ companyId: 'c2' });
    expect(
      await createEvent(prismaFor(tx), manager, baseInput({ linkedOrganizationId: 'org1' }))
    ).toEqual({ ok: false, error: 'validation' });
  });

  it('чужой attendee → validation (count меньше набора)', async () => {
    const tx = makeTx();
    tx.user.count.mockResolvedValue(1);
    expect(
      await createEvent(prismaFor(tx), manager, baseInput({ attendeeIds: ['u2', 'u3'] }))
    ).toEqual({ ok: false, error: 'validation' });
  });

  it('валидные линки проходят и попадают в create', async () => {
    const tx = makeTx();
    tx.order.findUnique.mockResolvedValue({ companyId: 'c1' });
    tx.organization.findUnique.mockResolvedValue({ companyId: 'c1' });
    const res = await createEvent(
      prismaFor(tx),
      manager,
      baseInput({ linkedOrderId: 'o1', linkedOrganizationId: 'org1' })
    );
    expect(res).toEqual({ ok: true, id: 'e1' });
    expect(tx.calendarEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ linkedOrderId: 'o1', linkedOrganizationId: 'org1' }),
    });
  });

  it('не-доменная ошибка транзакции re-throw-ится', async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as PrismaClient;
    await expect(createEvent(prisma, manager, baseInput())).rejects.toThrow('boom');
  });
});

describe('updateEvent', () => {
  it('staffGate: partner → forbidden; невалидный input → validation', async () => {
    expect(await updateEvent({} as never, partner, 'e1', baseInput())).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await updateEvent({} as never, manager, 'e1', baseInput({ title: '' }))).toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('событие не найдено → not_found', async () => {
    const tx = makeTx();
    tx.calendarEvent.findUnique.mockResolvedValue(null);
    expect(await updateEvent(prismaFor(tx), manager, 'ghost', baseInput())).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('canSeeEvent deny (own-уровень, чужое событие) → not_found, без leak', async () => {
    const tx = makeTx();
    tx.calendarEvent.findUnique.mockResolvedValue(existingRow({ createdById: 'other' }));
    expect(await updateEvent(prismaFor(tx), ownLevelManager, 'e1', baseInput())).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(tx.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('успех: remindAt пересчитан, attendeeIds undefined → участников не трогаем, audit', async () => {
    const tx = makeTx();
    tx.calendarEvent.findUnique.mockResolvedValue(existingRow());
    const res = await updateEvent(prismaFor(tx), manager, 'e1', baseInput({ remindMinutes: 60 }));
    expect(res).toEqual({ ok: true });
    expect(tx.calendarEvent.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({ remindAt: new Date(FUTURE.getTime() - 60 * 60_000) }),
    });
    // reminderSentAt был null → rearm не нужен, ключа нет в data.
    expect(tx.calendarEvent.update.mock.calls[0][0].data).not.toHaveProperty('reminderSentAt');
    expect(tx.calendarEventAttendee.findMany).not.toHaveBeenCalled();
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'calendar_event_updated',
        entityId: 'e1',
        before: { title: 'Старое' },
      })
    );
  });

  it('rearm: reminderSentAt сброшен, если новое remindAt в будущем', async () => {
    const tx = makeTx();
    tx.calendarEvent.findUnique.mockResolvedValue(
      existingRow({ reminderSentAt: new Date('2026-01-01T00:00:00Z') })
    );
    await updateEvent(prismaFor(tx), manager, 'e1', baseInput({ remindMinutes: 15 }));
    expect(tx.calendarEvent.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({ reminderSentAt: null }),
    });
  });

  it('без rearm: новое remindAt в прошлом или напоминание снято', async () => {
    // (а) remindAt в прошлом
    const tx1 = makeTx();
    tx1.calendarEvent.findUnique.mockResolvedValue(
      existingRow({ reminderSentAt: new Date('2026-01-01T00:00:00Z') })
    );
    await updateEvent(
      prismaFor(tx1),
      manager,
      'e1',
      baseInput({ startsAt: PAST, remindMinutes: 15 })
    );
    expect(tx1.calendarEvent.update.mock.calls[0][0].data).not.toHaveProperty('reminderSentAt');
    // (б) remindMinutes null → nextRemindAt null
    const tx2 = makeTx();
    tx2.calendarEvent.findUnique.mockResolvedValue(
      existingRow({ reminderSentAt: new Date('2026-01-01T00:00:00Z') })
    );
    await updateEvent(prismaFor(tx2), manager, 'e1', baseInput({ remindMinutes: null }));
    expect(tx2.calendarEvent.update.mock.calls[0][0].data).toMatchObject({ remindAt: null });
    expect(tx2.calendarEvent.update.mock.calls[0][0].data).not.toHaveProperty('reminderSentAt');
  });

  it('syncAttendees: добавляет недостающих и удаляет лишних', async () => {
    const tx = makeTx();
    tx.calendarEvent.findUnique.mockResolvedValue(existingRow());
    tx.calendarEventAttendee.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    tx.user.count.mockResolvedValue(2);
    const res = await updateEvent(
      prismaFor(tx),
      manager,
      'e1',
      baseInput({ attendeeIds: ['u2', 'u3'] })
    );
    expect(res).toEqual({ ok: true });
    expect(tx.calendarEventAttendee.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'e1', userId: { in: ['u1'] } },
    });
    expect(tx.calendarEventAttendee.createMany).toHaveBeenCalledWith({
      data: [{ eventId: 'e1', userId: 'u3' }],
    });
  });

  it('syncAttendees: без изменений — deleteMany/createMany не вызываются', async () => {
    const tx = makeTx();
    tx.calendarEvent.findUnique.mockResolvedValue(existingRow());
    tx.calendarEventAttendee.findMany.mockResolvedValue([{ userId: 'u2' }]);
    tx.user.count.mockResolvedValue(1);
    await updateEvent(prismaFor(tx), manager, 'e1', baseInput({ attendeeIds: ['u2'] }));
    expect(tx.calendarEventAttendee.deleteMany).not.toHaveBeenCalled();
    expect(tx.calendarEventAttendee.createMany).not.toHaveBeenCalled();
  });

  it('чужой линк при update → validation', async () => {
    const tx = makeTx();
    tx.calendarEvent.findUnique.mockResolvedValue(existingRow());
    tx.order.findUnique.mockResolvedValue({ companyId: 'c2' });
    expect(
      await updateEvent(prismaFor(tx), manager, 'e1', baseInput({ linkedOrderId: 'o1' }))
    ).toEqual({ ok: false, error: 'validation' });
  });

  it('не-доменная ошибка re-throw-ится', async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as PrismaClient;
    await expect(updateEvent(prisma, manager, 'e1', baseInput())).rejects.toThrow('db down');
  });
});

describe('deleteEvent', () => {
  it('staffGate: partner → forbidden', async () => {
    expect(await deleteEvent({} as never, partner, 'e1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('не найдено → not_found; deny → not_found', async () => {
    const tx = makeTx();
    tx.calendarEvent.findUnique.mockResolvedValue(null);
    expect(await deleteEvent(prismaFor(tx), manager, 'ghost')).toEqual({
      ok: false,
      error: 'not_found',
    });

    const tx2 = makeTx();
    tx2.calendarEvent.findUnique.mockResolvedValue(existingRow({ companyId: 'c2' }));
    expect(await deleteEvent(prismaFor(tx2), manager, 'e1')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(tx2.calendarEvent.delete).not.toHaveBeenCalled();
  });

  it('успех: delete + audit calendar_event_deleted', async () => {
    const tx = makeTx();
    tx.calendarEvent.findUnique.mockResolvedValue(existingRow());
    const res = await deleteEvent(prismaFor(tx), manager, 'e1');
    expect(res).toEqual({ ok: true });
    expect(tx.calendarEvent.delete).toHaveBeenCalledWith({ where: { id: 'e1' } });
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'calendar_event_deleted',
        entity: 'calendar_event',
        entityId: 'e1',
        before: { title: 'Старое' },
      })
    );
  });

  it('не-доменная ошибка re-throw-ится', async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(new Error('crash')),
    } as unknown as PrismaClient;
    await expect(deleteEvent(prisma, manager, 'e1')).rejects.toThrow('crash');
  });
});

describe('REMIND_MINUTES', () => {
  it('контракт селекта напоминаний: 15 мин / 1 час / 1 день', () => {
    expect(REMIND_MINUTES).toEqual([15, 60, 1440]);
  });
});
