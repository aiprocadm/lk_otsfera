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
  /**
   * Дебиторка считается ГРУППИРОВКОЙ в базе, а не выборкой всех заказов в
   * память: на ста тысячах заказов второе перестало укладываться в бюджет
   * `У-248`. Поэтому подменяются `groupBy`, справочник организаций и сырой
   * запрос «ответственный у самого старого долга».
   */
  function db(groups: unknown[], orgs: unknown[] = [{ id: 'o1', name: 'Ромашка' }]) {
    const groupBy = vi.fn(async () => groups);
    const orgFindMany = vi.fn(async () => orgs);
    const queryRaw = vi.fn(async () => [
      { organizationId: 'o1', name: 'Иванов', email: 'i@x' },
      { organizationId: 'o2', name: null, email: 'v@x' },
    ]);
    // Аргументы читаются как `unknown[][]`: у `vi.fn` без параметров кортеж
    // пустой, и точечный доступ `calls[0][0]` типы бы не пропустили.
    const calls = () => groupBy.mock.calls as unknown as Array<[{ where: Record<string, any> }]>;
    return {
      prisma: {
        order: { groupBy },
        organization: { findMany: orgFindMany },
        $queryRaw: queryRaw,
      } as unknown as PrismaClient,
      groupBy,
      queryRaw,
      calls,
    };
  }

  /** Строка группировки: суммы и дата самого старого неоплаченного заказа. */
  const group = (over: Record<string, unknown> = {}) => ({
    organizationId: 'o1',
    _sum: { totalAmount: D('1500'), paidAmount: D('400') },
    _min: { createdAt: new Date('2026-07-01') },
    ...over,
  });

  it('долгов нет — пусто, а не ошибка', async () => {
    const { prisma, queryRaw } = db([]);
    expect(await getReceivables(prisma, { companyId: 'c1' })).toEqual({
      rows: [],
      totalDebt: '0.00',
      olderThanDays: 0,
    });
    // Долгов нет — и лишних запросов тоже: спрашивать нечего.
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('считает долг по организации, берёт самый старый заказ и ответственного', async () => {
    const { prisma, calls } = db([group()]);
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

  it('суммы считает база, а не память: ни одной выборки заказов', async () => {
    // Регресс `У-248`: прежняя редакция тянула ВСЕ неоплаченные заказы в
    // JavaScript и складывала их циклом — на ста тысячах заказов это и было
    // медленно. Выборки заказов у сервиса быть не должно вовсе.
    const { prisma } = db([group()]);
    await getReceivables(prisma, { companyId: 'c1' });
    expect(
      (prisma as unknown as { order: Record<string, unknown> }).order.findMany
    ).toBeUndefined();
  });

  it('у организации нет имени в справочнике — прочерк, а не падение отчёта', async () => {
    const { prisma } = db([group()], []);
    const res = await getReceivables(prisma, { companyId: 'c1' });
    expect(res.rows[0]!.organizationName).toBe('—');
  });

  it('у ответственного нет имени — берётся почта', async () => {
    const { prisma } = db([group({ organizationId: 'o2' })], [{ id: 'o2', name: 'Вторая' }]);
    const res = await getReceivables(prisma, { companyId: 'c1' });
    expect(res.rows[0]!.managerName).toBe('v@x');
  });

  it('суммы у группы пустые — считаем нулями, а не роняем отчёт', async () => {
    // Группировка возвращает `null`, когда суммировать нечего (например, у
    // всех заказов организации сумма не проставлена). Ноль — единственный
    // честный ответ: строка просто не попадёт в долги.
    const { prisma } = db([group({ _sum: { totalAmount: null, paidAmount: null } })]);

    const res = await getReceivables(prisma, { companyId: 'c1' });

    expect(res.rows).toHaveLength(0);
    expect(res.totalDebt).toBe('0.00');
  });

  it('переплата не показывается отрицательным долгом', async () => {
    const { prisma } = db([group({ _sum: { totalAmount: D('100'), paidAmount: D('300') } })]);
    const res = await getReceivables(prisma, { companyId: 'c1' });
    expect(res.rows).toHaveLength(0);
    expect(res.totalDebt).toBe('0.00');
  });

  it('фильтр «старше N дней» отсекает молодые долги', async () => {
    const { prisma } = db([group({ _min: { createdAt: new Date() } })]);
    const res = await getReceivables(prisma, { companyId: 'c1', olderThanDays: 30 });
    expect(res.rows).toHaveLength(0);
    expect(res.olderThanDays).toBe(30);
  });

  it('даты у долга нет — строка не выпадает, но и фильтр её не пропускает', async () => {
    const { prisma } = db([group({ _min: { createdAt: null } })]);
    expect((await getReceivables(prisma, { companyId: 'c1' })).rows[0]!.oldestDays).toBeNull();
    const filtered = await getReceivables(prisma, { companyId: 'c1', olderThanDays: 10 });
    expect(filtered.rows).toHaveLength(0);
  });

  it('сортировка — от большего долга к меньшему', async () => {
    const { prisma } = db(
      [
        group({ organizationId: 'o1', _sum: { totalAmount: D('200'), paidAmount: D('0') } }),
        group({ organizationId: 'o2', _sum: { totalAmount: D('900'), paidAmount: D('0') } }),
      ],
      [
        { id: 'o1', name: 'Ромашка' },
        { id: 'o2', name: 'Вторая' },
      ]
    );
    const res = await getReceivables(prisma, { companyId: 'c1' });
    expect(res.rows.map((r) => r.organizationId)).toEqual(['o2', 'o1']);
  });
});

describe('Коммуникации', () => {
  function db(rows: unknown[], calls: unknown[] = [], slaHours: number | null = 2) {
    const queryRaw = vi.fn(async () => rows);
    const prisma = {
      $queryRaw: queryRaw,
      company: {
        findUnique: vi.fn(async () => (slaHours === null ? null : { slaResponseHours: slaHours })),
      },
      call: { findMany: vi.fn(async () => calls) },
    } as unknown as PrismaClient;
    return { prisma, queryRaw };
  }

  it('компании нет — порог берётся общий, отчёт не падает', async () => {
    // Такое бывает у администратора, смотрящего разрез без выбранной
    // компании. Показать «просрочек нет» из-за отсутствия порога было бы
    // хуже, чем посчитать по умолчанию: руководитель решил бы, что всё ровно.
    const { prisma } = db(
      [{ dialogId: 'd1', channel: 'cabinet', assigneeId: 'm1', assigneeName: 'И', minutes: 2000 }],
      [],
      null
    );

    const res = await getCommunications(prisma, PERIOD);

    expect(res.slaHours).toBe(24);
    expect(res.byChannel[0]!.overSla).toBe(1);
  });

  it('незнакомый канал из базы сводится к «Кабинету», а не ломает отчёт', async () => {
    // Канал приходит строкой и может оказаться новым (или прежним, который
    // убрали из справочника). Отдельной безымянной строки в отчёте быть не
    // должно: цифры уйдут в понятную корзину, а не в графу без подписи.
    const { prisma } = db([
      { dialogId: 'd1', channel: 'sms', assigneeId: 'm1', assigneeName: 'И', minutes: 5 },
    ]);
    const res = await getCommunications(prisma, PERIOD);
    expect(res.byChannel[0]).toMatchObject({ channel: 'cabinet', channelLabel: 'Кабинет' });
  });

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
  function db(
    leads: unknown[],
    deals: unknown[],
    promoted: unknown[],
    requests: unknown[],
    messages: unknown[] = [],
    inboundCalls = 0
  ) {
    const leadGroupBy = vi
      .fn()
      .mockResolvedValueOnce(leads)
      .mockResolvedValueOnce(deals)
      .mockResolvedValueOnce(promoted);
    const messageGroupBy = vi.fn<(args: unknown) => Promise<unknown[]>>(async () => messages);
    const callCount = vi.fn<(args: unknown) => Promise<number>>(async () => inboundCalls);
    const prisma = {
      lead: { groupBy: leadGroupBy },
      clientRequest: { groupBy: vi.fn(async () => requests) },
      inboundMessage: { groupBy: messageGroupBy },
      call: { count: callCount },
    } as unknown as PrismaClient;
    return { prisma, leadGroupBy, messageGroupBy, callCount };
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

  // `У-334` (`Д-68`, ТЗ 28.10.2026): на стенде в октябре 5 вопросов из
  // кабинета, а «Воронка» показывала 2 обращения — считались только заявки.
  it('обращения по источникам — это и сообщения по каналам, и входящие звонки', async () => {
    const { prisma, messageGroupBy, callCount } = db(
      [],
      [],
      [],
      [{ source: 'organization_cabinet', _count: { _all: 1 } }],
      [
        { channel: 'cabinet', _count: { _all: 5 } },
        { channel: 'telegram', _count: { _all: 2 } },
      ],
      3
    );
    const res = await getSources(prisma, PERIOD);
    expect(res.requests.map((r) => [r.label, r.requests])).toEqual([
      ['Из кабинета', 5],
      ['Звонки', 3],
      ['Telegram', 2],
      ['Кабинет заказчика', 1],
    ]);
    // Граница компании и период — в каждом новом запросе.
    expect(messageGroupBy.mock.calls[0]![0]).toMatchObject({ where: { companyId: 'c1' } });
    expect(callCount.mock.calls[0]![0]).toMatchObject({
      where: { companyId: 'c1', direction: 'inbound' },
    });
  });

  it('звонков не было — строки «Звонки» нет', async () => {
    const { prisma } = db([], [], [], [], [], 0);
    expect((await getSources(prisma, PERIOD)).requests).toEqual([]);
  });

  it('незнакомый источник показывается как есть, а не прячется', async () => {
    const { prisma } = db([{ source: 'новый_канал', _count: { _all: 1 } }], [], [], []);
    const res = await getSources(prisma, PERIOD);
    expect(res.leads[0]!.label).toBe('новый_канал');
  });

  it('незнакомый источник ОБРАЩЕНИЙ — то же правило, свой справочник', async () => {
    // Справочники у лидов и обращений разные; починив один, легко забыть
    // второй — и строка молча исчезла бы из отчёта.
    const { prisma } = db([], [], [], [{ source: 'новая_форма', _count: { _all: 3 } }]);

    const res = await getSources(prisma, PERIOD);

    expect(res.requests[0]).toMatchObject({ label: 'новая_форма', requests: 3 });
  });

  it('лидов не было — конверсия ПРОЧЕРК, а не ноль процентов', async () => {
    const { prisma } = db([{ source: 'website', _count: { _all: 0 } }], [], [], []);

    const res = await getSources(prisma, PERIOD);

    // Ноль прочитали бы как «ни один лид не дошёл», а лидов вообще не было.
    expect(res.leads[0]!.conversionPct).toBeNull();
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

  it('организации без партнёра в отчёт не попадают, а партнёр без имени — под своим кодом', async () => {
    // Прямые клиенты учебного центра к партнёрской аналитике отношения не
    // имеют: посчитай их — и доля партнёров в отчёте окажется заниженной.
    // А у самого партнёра справочная запись может быть удалена: строка без
    // подписи выглядит как сбой отчёта.
    const { prisma } = db([
      { id: 'o1', partnerId: null, partner: null },
      { id: 'o2', partnerId: 'p-no-name', partner: null },
    ]);
    const res = await getPartnersAnalytics(prisma, PERIOD);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      partnerId: 'p-no-name',
      partnerName: 'p-no-name',
      organizations: 1,
    });
  });
});
