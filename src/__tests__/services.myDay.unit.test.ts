import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 11 PR-2 (Модуль 15, ФТ-15.3) — агрегатор «Мой день».
 * Проверяем состав карточек, отсев (отменённые и уже переданные заказы),
 * порядок стадий и честные нули.
 */

const { getCompanyTeamVisibility, managerOrderScope } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  managerOrderScope: vi.fn(() => ({ managerId: 'm1' })),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility, managerOrderScope }));

const { taskFiltersWhere } = vi.hoisted(() => ({ taskFiltersWhere: vi.fn(() => ({ t: true })) }));
vi.mock('@/lib/services/tasks/board', () => ({ taskFiltersWhere }));

const { dealScopeWhere } = vi.hoisted(() => ({ dealScopeWhere: vi.fn(() => ({ d: true })) }));
vi.mock('@/lib/services/deals/board', () => ({ dealScopeWhere }));

const { countIntake, intakeInboundWhere, intakeCallWhere } = vi.hoisted(() => ({
  countIntake: vi.fn(),
  intakeInboundWhere: vi.fn(() => ({ i: true })),
  intakeCallWhere: vi.fn(() => ({ c: true })),
}));
vi.mock('@/lib/services/intake/list', () => ({
  countIntake,
  intakeInboundWhere,
  intakeCallWhere,
}));

const { evaluateReadinessBatch } = vi.hoisted(() => ({ evaluateReadinessBatch: vi.fn() }));
vi.mock('@/lib/services/manager/orderDelivery', () => ({
  evaluateReadinessBatch,
  READINESS_SELECT: {},
}));

import { getMyDay } from '@/lib/services/manager/myDay';
import type { SessionPayload } from '@/lib/auth/jwt';

const session = { sub: 'm1', role: 'manager', companyId: 'co-1' } as unknown as SessionPayload;
const NOW = new Date('2026-07-28T12:00:00Z');

type PrismaStub = {
  orders?: unknown[];
  taskCounts?: number[];
  deals?: Array<{ stageId: string | null; _count: { _all: number } }>;
  stages?: Array<{ id: string; name: string; position: number }>;
  inbound?: number;
  calls?: number;
  // `У-226` (этап 4): четыре новых показателя сводки.
  dialogs?: number;
  proposals?: number;
  checklist?: number;
  events?: number;
};

function makePrisma(stub: PrismaStub = {}) {
  const taskCounts = [...(stub.taskCounts ?? [0, 0])];
  const orderFindMany = vi.fn().mockResolvedValue(stub.orders ?? []);
  const dealStageFindMany = vi.fn().mockResolvedValue(stub.stages ?? []);
  const dialogCount = vi.fn().mockResolvedValue(stub.dialogs ?? 0);
  const documentCount = vi.fn().mockResolvedValue(stub.proposals ?? 0);
  const checklistCount = vi.fn().mockResolvedValue(stub.checklist ?? 0);
  const eventCount = vi.fn().mockResolvedValue(stub.events ?? 0);
  return {
    prisma: {
      task: { count: vi.fn(async () => taskCounts.shift() ?? 0) },
      order: { findMany: orderFindMany },
      deal: { groupBy: vi.fn().mockResolvedValue(stub.deals ?? []) },
      dealStage: { findMany: dealStageFindMany },
      inboundMessage: { count: vi.fn().mockResolvedValue(stub.inbound ?? 0) },
      call: { count: vi.fn().mockResolvedValue(stub.calls ?? 0) },
      messengerDialog: { count: dialogCount },
      document: { count: documentCount },
      taskChecklistItem: { count: checklistCount },
      calendarEvent: { count: eventCount },
    } as never,
    orderFindMany,
    dealStageFindMany,
    dialogCount,
    documentCount,
    checklistCount,
    eventCount,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  countIntake.mockResolvedValue(0);
  evaluateReadinessBatch.mockResolvedValue([]);
});

describe('getMyDay', () => {
  it('пустой день — честные нули, а не пропавшие карточки', async () => {
    const { prisma } = makePrisma();
    const data = await getMyDay(prisma, session, false, NOW);
    expect(data).toEqual({
      tasksToday: 0,
      tasksOverdue: 0,
      intake: 0,
      readyToDeliver: 0,
      readyOrders: [],
      readyTruncated: false,
      dealsOpen: 0,
      dealsByStage: [],
      inboundFresh: 0,
      callsMissed: 0,
      // `У-226`: новые показатели тоже обязаны быть честными нулями.
      dialogsWaiting: 0,
      proposalsExpiring: 0,
      checklistOpen: 0,
      eventsToday: 0,
    });
  });

  it('задачи: сегодняшние считаются по границам дня, просроченные — своим фильтром', async () => {
    const { prisma } = makePrisma({ taskCounts: [3, 5] });
    const data = await getMyDay(prisma, session, false, NOW);
    expect(data.tasksToday).toBe(3);
    expect(data.tasksOverdue).toBe(5);
    expect(taskFiltersWhere).toHaveBeenCalledWith(session, { scope: 'mine' }, NOW);
    expect(taskFiltersWhere).toHaveBeenCalledWith(session, { scope: 'mine', overdue: true }, NOW);
  });

  it('в выборку заказов не попадают отменённые и уже переданные', async () => {
    const { prisma, orderFindMany } = makePrisma();
    await getMyDay(prisma, session, false, NOW);
    const where = orderFindMany.mock.calls[0][0].where;
    expect(where.AND).toContainEqual({ resultDeliveredAt: null });
    expect(where.AND).toContainEqual({ executionStatus: { not: 'cancelled' } });
    expect(managerOrderScope).toHaveBeenCalledWith(session, false);
  });

  it('«Готово к передаче» считает только готовые и показывает первые пять', async () => {
    const orders = Array.from({ length: 7 }, (_, i) => ({
      id: `o${i}`,
      orderNumber: `${i}`,
      title: `Заказ ${i}`,
      items: [],
    }));
    const { prisma } = makePrisma({ orders });
    // Не готов только последний.
    evaluateReadinessBatch.mockResolvedValue(
      orders.map((_, i) => ({ ready: i < 6, gaps: [], items: [] }))
    );
    const data = await getMyDay(prisma, session, false, NOW);
    expect(data.readyToDeliver).toBe(6);
    expect(data.readyOrders).toHaveLength(5);
    expect(data.readyOrders[0]).toEqual({ id: 'o0', orderNumber: '0', title: 'Заказ 0' });
    expect(data.readyTruncated).toBe(true);
  });

  it('готовых ровно столько, сколько поместилось — «и другие» не показываем', async () => {
    const orders = [{ id: 'o1', orderNumber: '1', title: 'Заказ', items: [] }];
    const { prisma } = makePrisma({ orders });
    evaluateReadinessBatch.mockResolvedValue([{ ready: true, gaps: [], items: [] }]);
    const data = await getMyDay(prisma, session, false, NOW);
    expect(data.readyToDeliver).toBe(1);
    expect(data.readyTruncated).toBe(false);
  });

  it('сделки группируются по стадиям в порядке доски', async () => {
    const { prisma } = makePrisma({
      deals: [
        { stageId: 's2', _count: { _all: 2 } },
        { stageId: 's1', _count: { _all: 3 } },
      ],
      stages: [
        { id: 's1', name: 'Первичный контакт', position: 1 },
        { id: 's2', name: 'Переговоры', position: 2 },
      ],
    });
    const data = await getMyDay(prisma, session, false, NOW);
    expect(data.dealsByStage).toEqual([
      { stageName: 'Первичный контакт', count: 3 },
      { stageName: 'Переговоры', count: 2 },
    ]);
    expect(data.dealsOpen).toBe(5);
    expect(dealScopeWhere).toHaveBeenCalledWith(session, { managerId: 'm1' });
  });

  it('сделка без стадии не теряется — уходит в конец', async () => {
    const { prisma } = makePrisma({
      deals: [
        { stageId: null, _count: { _all: 1 } },
        { stageId: 's1', _count: { _all: 4 } },
      ],
      stages: [{ id: 's1', name: 'Переговоры', position: 1 }],
    });
    const data = await getMyDay(prisma, session, false, NOW);
    expect(data.dealsByStage).toEqual([
      { stageName: 'Переговоры', count: 4 },
      { stageName: 'Без стадии', count: 1 },
    ]);
    expect(data.dealsOpen).toBe(5);
  });

  it('без сделок словарь стадий не запрашивается', async () => {
    const { prisma, dealStageFindMany } = makePrisma();
    await getMyDay(prisma, session, false, NOW);
    expect(dealStageFindMany).not.toHaveBeenCalled();
  });

  it('стадия, пропавшая из словаря, не роняет карточку', async () => {
    const { prisma } = makePrisma({
      deals: [{ stageId: 'ghost', _count: { _all: 2 } }],
      stages: [],
    });
    const data = await getMyDay(prisma, session, false, NOW);
    expect(data.dealsByStage).toEqual([{ stageName: 'Без стадии', count: 2 }]);
  });

  it('свежие обращения и пропущенные звонки — за сутки, своими скоупами', async () => {
    const { prisma } = makePrisma({ inbound: 4, calls: 2 });
    const data = await getMyDay(prisma, session, false, NOW);
    expect(data.inboundFresh).toBe(4);
    expect(data.callsMissed).toBe(2);
    expect(intakeInboundWhere).toHaveBeenCalledWith(session);
    expect(intakeCallWhere).toHaveBeenCalledWith(session);
  });

  it('`У-226`: четыре новых показателя считаются своими условиями', async () => {
    const { prisma, dialogCount, documentCount, checklistCount, eventCount } = makePrisma({
      dialogs: 4,
      proposals: 2,
      checklist: 9,
      events: 3,
    });
    const data = await getMyDay(prisma, session, false, NOW);
    expect(data.dialogsWaiting).toBe(4);
    expect(data.proposalsExpiring).toBe(2);
    expect(data.checklistOpen).toBe(9);
    expect(data.eventsToday).toBe(3);

    // Переписка — МОЯ: без этого условия менеджер видел бы общую очередь.
    expect(dialogCount.mock.calls[0][0].where.assigneeId).toBe('m1');
    // КП: уже истёкшие не считаем — напоминать о них поздно.
    expect(documentCount.mock.calls[0][0].where.validUntil.gte).toEqual(NOW);
    // Шаги чек-листов — только из незакрытых задач моего охвата.
    expect(checklistCount.mock.calls[0][0].where.isDone).toBe(false);
    expect(checklistCount.mock.calls[0][0].where.task.AND).toContainEqual({
      status: { not: 'done' },
    });
    // События — мои и те, куда меня позвали.
    expect(eventCount.mock.calls[0][0].where.OR).toEqual([
      { createdById: 'm1' },
      { attendees: { some: { userId: 'm1' } } },
    ]);
  });

  it('без переданного teamMode флаг читается свежим', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const { prisma } = makePrisma();
    await getMyDay(prisma, session);
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(prisma, 'co-1');
    expect(managerOrderScope).toHaveBeenCalledWith(session, true);
  });
});
