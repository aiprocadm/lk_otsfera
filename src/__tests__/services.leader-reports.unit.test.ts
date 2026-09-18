import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { getReceivables } from '@/lib/services/leader/receivables';
import { getCommunications } from '@/lib/services/leader/communications';
import { getSources } from '@/lib/services/leader/sources';
import { getPartnersAnalytics } from '@/lib/services/leader/partnersAnalytics';

/**
 * Четыре новых разреза «Аналитики» (`У-243`, `У-247`, этап 7).
 *
 * У каждого проверяется одно и то же: пустой период даёт ноль, а не ошибку;
 * граница компании стоит в запросе; краевой случай не превращается в молчание.
 */
const D = (v: string) => new Prisma.Decimal(v);
const PERIOD = { companyId: 'c1', from: new Date('2026-09-01'), to: new Date('2026-10-01') };

beforeEach(() => vi.clearAllMocks());

describe('Дебиторка', () => {
  function db(orders: unknown[]) {
    const findMany = vi.fn(async () => orders);
    // Аргументы читаются как `unknown[][]`: у `vi.fn` без параметров кортеж
    // пустой, и точечный доступ `calls[0][0]` типы бы не пропустили.
    const calls = () => findMany.mock.calls as unknown as Array<[{ where: Record<string, any> }]>;
    return { prisma: { order: { findMany } } as unknown as PrismaClient, findMany, calls };
  }
  const order = (over: Record<string, unknown> = {}) => ({
    organizationId: 'o1',
    totalAmount: D('1000'),
    paidAmount: D('400'),
    createdAt: new Date('2026-08-01'),
    organization: { name: 'Ромашка' },
    manager: { name: 'Иванов', email: 'i@x' },
    ...over,
  });

  it('долгов нет — пусто, а не ошибка', async () => {
    const { prisma } = db([]);
    expect(await getReceivables(prisma, { companyId: 'c1' })).toEqual({
      rows: [],
      totalDebt: '0.00',
      olderThanDays: 0,
    });
  });

  it('считает долг по организации, берёт самый старый заказ и ответственного', async () => {
    const { prisma, calls } = db([
      order(),
      order({ totalAmount: D('500'), paidAmount: D('0'), createdAt: new Date('2026-07-01') }),
    ]);
    const res = await getReceivables(prisma, { companyId: 'c1' });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      organizationName: 'Ромашка',
      billed: '1500.00',
      paid: '400.00',
      debt: '1100.00',
      managerName: 'Иванов',
    });
    expect(res.totalDebt).toBe('1100.00');
    // Только те заказы, по которым ещё ждут денег.
    expect(calls()[0]![0].where.financialStatus).toEqual({ in: ['billed', 'partially_paid'] });
    expect(calls()[0]![0].where.companyId).toBe('c1');
  });

  it('переплата не показывается отрицательным долгом', async () => {
    const { prisma } = db([order({ totalAmount: D('100'), paidAmount: D('300') })]);
    const res = await getReceivables(prisma, { companyId: 'c1' });
    expect(res.rows).toHaveLength(0);
    expect(res.totalDebt).toBe('0.00');
  });

  it('фильтр «старше N дней» отсекает молодые долги', async () => {
    const fresh = new Date();
    const { prisma } = db([order({ createdAt: fresh })]);
    const res = await getReceivables(prisma, { companyId: 'c1', olderThanDays: 30 });
    expect(res.rows).toHaveLength(0);
    expect(res.olderThanDays).toBe(30);
  });

  it('сортировка — от большего долга к меньшему', async () => {
    const { prisma } = db([
      order({ organizationId: 'o1', totalAmount: D('200'), paidAmount: D('0') }),
      order({
        organizationId: 'o2',
        totalAmount: D('900'),
        paidAmount: D('0'),
        organization: { name: 'Вторая' },
      }),
    ]);
    const res = await getReceivables(prisma, { companyId: 'c1' });
    expect(res.rows.map((r) => r.organizationId)).toEqual(['o2', 'o1']);
  });
});

describe('Коммуникации', () => {
  function db(rows: unknown[], calls: unknown[] = [], slaHours = 2) {
    const queryRaw = vi.fn(async () => rows);
    const prisma = {
      $queryRaw: queryRaw,
      company: { findUnique: vi.fn(async () => ({ slaResponseHours: slaHours })) },
      call: { findMany: vi.fn(async () => calls) },
    } as unknown as PrismaClient;
    return { prisma, queryRaw };
  }

  it('переписки и звонков не было — нули, а не ошибка', async () => {
    const { prisma } = db([]);
    const res = await getCommunications(prisma, PERIOD);
    expect(res.byChannel).toEqual([]);
    expect(res.calls).toEqual({ inbound: 0, answered: 0, missed: 0, outbound: 0 });
  });

  it('среднее считается только по отвеченным; без ответа считается отдельно', async () => {
    const { prisma } = db([
      {
        dialogId: 'd1',
        channel: 'telegram',
        assigneeId: 'm1',
        assigneeName: 'Иванов',
        minutes: 30,
      },
      {
        dialogId: 'd2',
        channel: 'telegram',
        assigneeId: 'm1',
        assigneeName: 'Иванов',
        minutes: 90,
      },
      { dialogId: 'd3', channel: 'telegram', assigneeId: null, assigneeName: null, minutes: null },
    ]);
    const res = await getCommunications(prisma, PERIOD);
    const tg = res.byChannel[0]!;
    expect(tg.dialogs).toBe(3);
    expect(tg.answered).toBe(2);
    // Без ответа в среднее не входит: иначе оно занижается тем, что не случилось.
    expect(tg.avgFirstResponseMin).toBe(60);
    expect(tg.waitingNoAnswer).toBe(1);
    // Порог компании — 2 часа: 90 минут в него укладываются, 30 тем более.
    expect(tg.overSla).toBe(0);
  });

  it('просрочка считается по порогу компании', async () => {
    const { prisma } = db(
      [{ dialogId: 'd1', channel: 'cabinet', assigneeId: 'm1', assigneeName: 'И', minutes: 200 }],
      [],
      2
    );
    const res = await getCommunications(prisma, PERIOD);
    expect(res.slaHours).toBe(2);
    expect(res.byChannel[0]!.overSla).toBe(1);
  });

  it('звонки: принят — тот, на который ответили; исходящие считаются отдельно', async () => {
    const { prisma } = db(
      [],
      [
        { direction: 'inbound', answeredAt: new Date() },
        { direction: 'inbound', answeredAt: null },
        { direction: 'outbound', answeredAt: null },
      ]
    );
    const res = await getCommunications(prisma, PERIOD);
    expect(res.calls).toEqual({ inbound: 2, answered: 1, missed: 1, outbound: 1 });
  });

  it('незнакомый канал не роняет отчёт', async () => {
    const { prisma } = db([
      { dialogId: 'd1', channel: 'факс', assigneeId: null, assigneeName: null, minutes: 5 },
    ]);
    const res = await getCommunications(prisma, PERIOD);
    expect(res.byChannel[0]!.channel).toBe('cabinet');
    expect(res.byManager[0]!.managerName).toBe('Не назначен');
  });
});

describe('Источники', () => {
  // Порядок важен: сервис спрашивает лиды, потом сделки, потом заказы.
  function db(leads: unknown[], deals: unknown[], promoted: unknown[], requests: unknown[]) {
    const leadGroupBy = vi
      .fn()
      .mockResolvedValueOnce(leads)
      .mockResolvedValueOnce(deals)
      .mockResolvedValueOnce(promoted);
    const prisma = {
      lead: { groupBy: leadGroupBy },
      clientRequest: { groupBy: vi.fn(async () => requests) },
    } as unknown as PrismaClient;
    return { prisma, leadGroupBy };
  }

  it('ничего не было — пусто, а не ошибка', async () => {
    const { prisma } = db([], [], [], []);
    expect(await getSources(prisma, PERIOD)).toEqual({
      leads: [],
      requests: [],
      totalLeads: 0,
      totalDeals: 0,
      totalOrders: 0,
    });
  });

  it('конверсия когортная и по источнику; граница компании — в запросе', async () => {
    const { prisma, leadGroupBy } = db(
      [
        { source: 'website', _count: { _all: 10 } },
        { source: 'call', _count: { _all: 4 } },
      ],
      [{ source: 'website', _count: { _all: 6 } }],
      [{ source: 'website', _count: { _all: 3 } }],
      [{ source: 'organization_cabinet', _count: { _all: 2 } }]
    );
    const res = await getSources(prisma, PERIOD);
    expect(res.leads[0]).toMatchObject({ label: 'Сайт', leads: 10, orders: 3, conversionPct: 30 });
    // Средний шаг воронки виден отдельно: из десяти лидов шесть дошли до сделки,
    // а заказом стали три — потеря видна там, где она случилась (`У-247`).
    expect(res.leads[0]!.deals).toBe(6);
    // Источник без единого заказа даёт ноль, а не пустоту.
    expect(res.leads[1]).toMatchObject({ label: 'Звонок', deals: 0, orders: 0, conversionPct: 0 });
    expect(res.totalLeads).toBe(14);
    expect(res.totalDeals).toBe(6);
    expect(res.totalOrders).toBe(3);
    expect(res.requests[0]).toMatchObject({ label: 'Кабинет заказчика', requests: 2 });
    expect(leadGroupBy.mock.calls[0][0].where.OR).toEqual([
      { assignedManager: { companyId: 'c1' } },
      { organization: { companyId: 'c1' } },
    ]);
    // Сделки спрашиваются той же когортой и с той же границей компании.
    expect(leadGroupBy.mock.calls[1][0].where).toMatchObject({
      promotedDealId: { not: null },
    });
    expect(leadGroupBy.mock.calls[1][0].where.OR).toEqual([
      { assignedManager: { companyId: 'c1' } },
      { organization: { companyId: 'c1' } },
    ]);
  });

  it('незнакомый источник показывается как есть, а не прячется', async () => {
    const { prisma } = db([{ source: 'новый_канал', _count: { _all: 1 } }], [], [], []);
    const res = await getSources(prisma, PERIOD);
    expect(res.leads[0]!.label).toBe('новый_канал');
  });
});

describe('Партнёры', () => {
  function db(orgs: unknown[], statements: unknown[] = [], requests: unknown[] = []) {
    const prisma = {
      organization: { findMany: vi.fn(async () => orgs) },
      commissionStatement: { findMany: vi.fn(async () => statements) },
      clientRequest: { groupBy: vi.fn(async () => requests) },
    } as unknown as PrismaClient;
    return { prisma };
  }

  it('у компании нет партнёров — пусто без лишних запросов', async () => {
    const { prisma } = db([]);
    expect(await getPartnersAnalytics(prisma, PERIOD)).toEqual({
      rows: [],
      totalAccrued: '0.00',
      totalPaid: '0.00',
    });
  });

  it('начислено — утверждённые и выплаченные; выплачено — только выплаченные', async () => {
    const { prisma } = db(
      [
        { id: 'o1', partnerId: 'p1', partner: { name: 'Первый' } },
        { id: 'o2', partnerId: 'p1', partner: { name: 'Первый' } },
      ],
      [
        { partnerId: 'p1', status: 'approved', totalCommissionAmount: D('100') },
        { partnerId: 'p1', status: 'paid', totalCommissionAmount: D('50') },
      ],
      [{ partnerId: 'p1', _count: { _all: 3 } }]
    );
    const res = await getPartnersAnalytics(prisma, PERIOD);
    expect(res.rows[0]).toMatchObject({
      partnerName: 'Первый',
      organizations: 2,
      accrued: '150.00',
      paid: '50.00',
      requests: 3,
    });
    expect(res.totalAccrued).toBe('150.00');
    expect(res.totalPaid).toBe('50.00');
  });

  it('партнёр без актов показывается с нулями, а не исчезает', async () => {
    const { prisma } = db([{ id: 'o1', partnerId: 'p2', partner: { name: 'Тихий' } }]);
    const res = await getPartnersAnalytics(prisma, PERIOD);
    expect(res.rows[0]).toMatchObject({ partnerName: 'Тихий', accrued: '0.00', requests: 0 });
  });
});
