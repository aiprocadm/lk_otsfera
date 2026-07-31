/**
 * M5 — unit-тесты read-агрегатора календаря (спека 2026-07-17-m5-calendar §3, §7).
 * listCalendarItems (события ∪ задачи), remindMinutesFrom, getEventFormOptions.
 * Mock-prisma без new PrismaClient.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  listCalendarItems,
  remindMinutesFrom,
  getEventFormOptions,
} from '@/lib/services/calendar/items';

const RANGE = { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-08-01T00:00:00Z') };

const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as unknown as SessionPayload;
const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as unknown as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as unknown as SessionPayload;

function makePrisma(over: Record<string, unknown> = {}): {
  prisma: PrismaClient;
  eventFindMany: ReturnType<typeof vi.fn>;
  taskFindMany: ReturnType<typeof vi.fn>;
} {
  const eventFindMany = vi.fn().mockResolvedValue([]);
  const taskFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    calendarEvent: { findMany: eventFindMany },
    task: { findMany: taskFindMany },
    ...over,
  } as unknown as PrismaClient;
  return { prisma, eventFindMany, taskFindMany };
}

function eventRow(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    title: 'Созвон',
    description: 'по проекту',
    location: 'Zoom',
    startsAt: new Date('2026-07-10T10:00:00Z'),
    endsAt: new Date('2026-07-10T11:00:00Z'),
    allDay: false,
    remindAt: new Date('2026-07-10T09:45:00Z'),
    createdById: 'm1',
    createdBy: { name: 'Мария' },
    attendees: [{ userId: 'u2', user: { name: 'Пётр' } }],
    linkedOrderId: 'o1',
    linkedOrder: { title: 'Заявка №1' },
    linkedOrganizationId: 'org1',
    linkedOrganization: { name: 'ООО Ромашка' },
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('listCalendarItems — гейт', () => {
  it('не-staff роль → [] без запросов', async () => {
    const { prisma, eventFindMany, taskFindMany } = makePrisma();
    expect(await listCalendarItems(prisma, partner, RANGE)).toEqual([]);
    expect(eventFindMany).not.toHaveBeenCalled();
    expect(taskFindMany).not.toHaveBeenCalled();
  });

  it('staff без companyId → []', async () => {
    const { prisma } = makePrisma();
    const noCompany = { sub: 'm9', role: 'manager', companyId: null } as unknown as SessionPayload;
    expect(await listCalendarItems(prisma, noCompany, RANGE)).toEqual([]);
  });
});

describe('listCalendarItems — склейка и маппинг', () => {
  it('события и задачи склеены, отсортированы по дате; поля смаппены', async () => {
    const { prisma, eventFindMany, taskFindMany } = makePrisma();
    eventFindMany.mockResolvedValue([eventRow()]);
    taskFindMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Позвонить',
        dueDate: new Date('2026-07-05T00:00:00Z'),
        priority: 'high',
        completedAt: null,
      },
      { id: 't2', title: 'Без срока', dueDate: null, priority: 'low', completedAt: null },
    ]);
    const items = await listCalendarItems(prisma, manager, RANGE);
    expect(items.map((i) => i.id)).toEqual(['t1', 'e1']); // задача 05.07 раньше события 10.07
    expect(items[1]).toEqual({
      kind: 'event',
      id: 'e1',
      title: 'Созвон',
      date: new Date('2026-07-10T10:00:00Z'),
      endsAt: new Date('2026-07-10T11:00:00Z'),
      allDay: false,
      location: 'Zoom',
      description: 'по проекту',
      createdById: 'm1',
      createdByName: 'Мария',
      attendeeIds: ['u2'],
      attendeeNames: ['Пётр'],
      remindMinutes: 15, // из remindAt = startsAt − 15 мин
      linkedOrderId: 'o1',
      linkedOrderTitle: 'Заявка №1',
      linkedOrganizationId: 'org1',
      linkedOrganizationName: 'ООО Ромашка',
      priority: null,
      completedAt: null,
    });
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'task',
        id: 't1',
        title: 'Позвонить',
        date: new Date('2026-07-05T00:00:00Z'),
        allDay: true,
        priority: 'high',
        remindMinutes: null,
      })
    );
  });

  it('событие без линков/напоминания: null-ветки маппинга', async () => {
    const { prisma, eventFindMany } = makePrisma();
    eventFindMany.mockResolvedValue([
      eventRow({
        remindAt: null,
        attendees: [],
        linkedOrderId: null,
        linkedOrder: null,
        linkedOrganizationId: null,
        linkedOrganization: null,
      }),
    ]);
    const [item] = await listCalendarItems(prisma, manager, RANGE);
    expect(item).toEqual(
      expect.objectContaining({
        remindMinutes: null,
        attendeeIds: [],
        attendeeNames: [],
        linkedOrderTitle: null,
        linkedOrganizationName: null,
      })
    );
  });
});

describe('listCalendarItems — scope where', () => {
  it("manager без профиля → floor-компания и tasks-уровень 'all'", async () => {
    const { prisma, eventFindMany, taskFindMany } = makePrisma();
    await listCalendarItems(prisma, manager, RANGE);
    const eventWhere = eventFindMany.mock.calls[0][0].where;
    expect(eventWhere.AND[0]).toEqual({ companyId: 'c1' });
    expect(eventWhere.AND[1]).toEqual({ startsAt: { lt: RANGE.to } });
    expect(eventWhere.AND[2]).toEqual({
      OR: [{ endsAt: null, startsAt: { gte: RANGE.from } }, { endsAt: { gt: RANGE.from } }],
    });
    const taskWhere = taskFindMany.mock.calls[0][0].where;
    expect(taskWhere.AND[0]).toEqual({ companyId: 'c1' });
    expect(taskWhere.AND[1]).toEqual({ dueDate: { gte: RANGE.from, lt: RANGE.to } });
  });

  it("уровень 'own' → scope-OR (создатель ∨ участник) и для событий, и для задач", async () => {
    const s = {
      ...manager,
      accessProfile: { tasks: 'own' },
    } as unknown as SessionPayload;
    const { prisma, eventFindMany, taskFindMany } = makePrisma();
    await listCalendarItems(prisma, s, RANGE);
    expect(eventFindMany.mock.calls[0][0].where.AND[0]).toEqual({
      AND: [
        { companyId: 'c1' },
        { OR: [{ createdById: 'm1' }, { attendees: { some: { userId: 'm1' } } }] },
      ],
    });
    expect(taskFindMany.mock.calls[0][0].where.AND[0]).toEqual({
      AND: [
        { companyId: 'c1' },
        { OR: [{ createdById: 'm1' }, { assignees: { some: { userId: 'm1' } } }] },
      ],
    });
  });

  it("уровень 'assigned' → тот же событийный OR (нет орг-скоупа у события)", async () => {
    const s = {
      ...manager,
      accessProfile: { tasks: 'assigned' },
      managedOrgIds: ['org1'],
    } as unknown as SessionPayload;
    const { prisma, eventFindMany } = makePrisma();
    await listCalendarItems(prisma, s, RANGE);
    expect(eventFindMany.mock.calls[0][0].where.AND[0]).toEqual({
      AND: [
        { companyId: 'c1' },
        { OR: [{ createdById: 'm1' }, { attendees: { some: { userId: 'm1' } } }] },
      ],
    });
  });

  it("уровень 'all' явно → только floor", async () => {
    const s = { ...manager, accessProfile: { tasks: 'all' } } as unknown as SessionPayload;
    const { prisma, eventFindMany } = makePrisma();
    await listCalendarItems(prisma, s, RANGE);
    expect(eventFindMany.mock.calls[0][0].where.AND[0]).toEqual({ companyId: 'c1' });
  });

  it('admin не сужается профилем (Model A): floor без OR', async () => {
    const s = { ...admin, accessProfile: { tasks: 'own' } } as unknown as SessionPayload;
    const { prisma, eventFindMany } = makePrisma();
    await listCalendarItems(prisma, s, RANGE);
    expect(eventFindMany.mock.calls[0][0].where.AND[0]).toEqual({ companyId: 'c1' });
  });
});

describe('remindMinutesFrom', () => {
  const startsAt = new Date('2026-07-10T10:00:00Z');
  it('null remindAt → null', () => {
    expect(remindMinutesFrom(startsAt, null)).toBeNull();
  });
  it('положительный интервал → минуты', () => {
    expect(remindMinutesFrom(startsAt, new Date('2026-07-10T09:00:00Z'))).toBe(60);
  });
  it('remindAt после startsAt (отрицательный) и совпадающий → null', () => {
    expect(remindMinutesFrom(startsAt, new Date('2026-07-10T10:30:00Z'))).toBeNull();
    expect(remindMinutesFrom(startsAt, startsAt)).toBeNull();
  });
});

describe('getEventFormOptions', () => {
  it('company-scoped выборки: users(staff, active)/organizations/orders', async () => {
    const userFindMany = vi.fn().mockResolvedValue([{ id: 'u1', name: 'Мария' }]);
    const orgFindMany = vi.fn().mockResolvedValue([{ id: 'org1', name: 'ООО Ромашка' }]);
    const orderFindMany = vi.fn().mockResolvedValue([{ id: 'o1', title: 'Заявка' }]);
    const prisma = {
      user: { findMany: userFindMany },
      organization: { findMany: orgFindMany },
      order: { findMany: orderFindMany },
    } as unknown as PrismaClient;
    const res = await getEventFormOptions(prisma, manager);
    expect(res).toEqual({
      users: [{ id: 'u1', name: 'Мария' }],
      organizations: [{ id: 'org1', name: 'ООО Ромашка' }],
      orders: [{ id: 'o1', title: 'Заявка' }],
    });
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c1', role: { in: ['admin', 'manager'] }, isActive: true },
      })
    );
    expect(orgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } })
    );
    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } })
    );
  });

  it('companyId null → NO_COMPANY_SENTINEL (fail-safe, пустые списки)', async () => {
    const userFindMany = vi.fn().mockResolvedValue([]);
    const orgFindMany = vi.fn().mockResolvedValue([]);
    const orderFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      user: { findMany: userFindMany },
      organization: { findMany: orgFindMany },
      order: { findMany: orderFindMany },
    } as unknown as PrismaClient;
    const noCompany = { sub: 'a1', role: 'admin', companyId: null } as unknown as SessionPayload;
    const res = await getEventFormOptions(prisma, noCompany);
    expect(res).toEqual({ users: [], organizations: [], orders: [] });
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: '__no_company__' }) })
    );
    expect(orgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: '__no_company__' } })
    );
  });
});
