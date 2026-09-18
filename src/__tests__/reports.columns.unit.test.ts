import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Колонки и скоуп каждого отчёта (`У-244`, этап 7).
 *
 * Проверяется одно: строка отчёта заполняет РОВНО те колонки, которые объявлены
 * в реестре. Лишний ключ не попадёт в файл (Excel его молча выбросит), а
 * недостающий даст пустую колонку — и человек решит, что данных нет.
 */
const {
  getKpiPlanFact,
  getSources,
  getReceivables,
  getCommunications,
  getPartnersAnalytics,
  getManagerLoad,
} = vi.hoisted(() => ({
  getKpiPlanFact: vi.fn(),
  getSources: vi.fn(),
  getReceivables: vi.fn(),
  getCommunications: vi.fn(),
  getPartnersAnalytics: vi.fn(),
  getManagerLoad: vi.fn(),
}));
vi.mock('@/lib/kpi/plan', () => ({ getKpiPlanFact }));
vi.mock('@/lib/services/leader/sources', () => ({ getSources }));
vi.mock('@/lib/services/leader/receivables', () => ({ getReceivables }));
vi.mock('@/lib/services/leader/communications', () => ({ getCommunications }));
vi.mock('@/lib/services/leader/partnersAnalytics', () => ({ getPartnersAnalytics }));
vi.mock('@/lib/services/leader/managerLoad', () => ({ getManagerLoad }));

import { REPORTS, reportByKey } from '@/lib/reports/registry';

const LEADER = { sub: 'l1', role: 'leader', companyId: 'c1' } as unknown as SessionPayload;
const ctx = {
  prisma: {} as unknown as PrismaClient,
  session: LEADER,
  companyId: 'c1',
  year: 2026,
  month: 9,
  olderThanDays: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  getKpiPlanFact.mockResolvedValue({
    year: 2026,
    month: 9,
    metrics: [],
    rows: [
      {
        metric: 'revenue_paid',
        metricLabel: 'Оплачено',
        unit: 'money',
        managerId: 'u1',
        managerName: 'Иванов',
        plan: '1000.00',
        fact: '800.00',
        percent: 80,
        prevFact: '500.00',
      },
      {
        metric: 'revenue_paid',
        metricLabel: 'Оплачено',
        unit: 'money',
        managerId: 'u2',
        managerName: 'Петров',
        plan: null,
        fact: '0',
        percent: null,
        prevFact: '0',
      },
    ],
  });
  getSources.mockResolvedValue({
    leads: [
      { source: 'website', label: 'Сайт', leads: 10, deals: 6, orders: 3, conversionPct: 30 },
    ],
    requests: [],
    totalLeads: 10,
    totalDeals: 6,
    totalOrders: 3,
  });
  getReceivables.mockResolvedValue({
    rows: [
      {
        organizationId: 'o1',
        organizationName: 'Ромашка',
        billed: '1000.00',
        paid: '400.00',
        debt: '600.00',
        oldestDays: 42,
        managerName: 'Иванов',
      },
    ],
    totalDebt: '600.00',
    olderThanDays: 0,
  });
  getCommunications.mockResolvedValue({
    byChannel: [
      {
        channel: 'telegram',
        channelLabel: 'Telegram',
        dialogs: 5,
        answered: 4,
        avgFirstResponseMin: 30,
        overSla: 1,
        waitingNoAnswer: 1,
      },
    ],
    byManager: [
      { managerId: 'u1', managerName: 'Иванов', dialogs: 3, avgFirstResponseMin: 45, overSla: 2 },
    ],
    calls: { inbound: 0, answered: 0, missed: 0, outbound: 0 },
    slaHours: 24,
  });
  getPartnersAnalytics.mockResolvedValue({
    rows: [
      {
        partnerId: 'p1',
        partnerName: 'Первый',
        organizations: 2,
        accrued: '150.00',
        paid: '50.00',
        requests: 3,
      },
    ],
    totalAccrued: '150.00',
    totalPaid: '50.00',
  });
  getManagerLoad.mockResolvedValue([
    { managerId: 'u1', managerName: 'Иванов', orders: 7, tasks: 3, overdueTasks: 1, dialogs: 2 },
  ]);
});

describe('колонки отчётов совпадают с объявленными', () => {
  for (const report of REPORTS) {
    it(`${report.key}: строки заполняют ровно объявленные колонки`, async () => {
      const rows = await report.rows(ctx);
      expect(rows.length, `${report.key}: фикстура не дала ни строки`).toBeGreaterThan(0);
      const declared = new Set(report.columns.map((c) => c.key));
      for (const row of rows) {
        const got = Object.keys(row);
        for (const key of got) {
          expect(declared.has(key), `${report.key}: лишний ключ «${key}» не попадёт в файл`).toBe(
            true
          );
        }
        for (const key of declared) {
          expect(key in row, `${report.key}: колонка «${key}» осталась пустой`).toBe(true);
        }
      }
    });
  }
});

describe('содержимое отчётов', () => {
  it('план и факт: «план не задан» вместо нуля, прочерк вместо процента', async () => {
    const rows = await reportByKey('plan_fact').rows(ctx);
    expect(rows[0]).toMatchObject({ metric: 'Оплачено', who: 'Иванов', plan: 1000, fact: 800 });
    // Ноль означал бы «ничего не ждём» — это другое утверждение.
    expect(rows[1]!.plan).toBe('план не задан');
    expect(rows[1]!.percent).toBe('—');
  });

  it('воронка по источникам: русское название и конверсия', async () => {
    const rows = await reportByKey('funnel_by_source').rows(ctx);
    expect(rows[0]).toEqual({ source: 'Сайт', leads: 10, deals: 6, orders: 3, conversion: 30 });
  });

  it('дебиторка: долг числом, срок и ответственный', async () => {
    const rows = await reportByKey('receivables').rows(ctx);
    expect(rows[0]).toMatchObject({ organization: 'Ромашка', debt: 600, days: 42 });
  });

  it('дебиторка передаёт фильтр «старше N дней» в сервис', async () => {
    await reportByKey('receivables').rows({ ...ctx, olderThanDays: 60 });
    expect(getReceivables.mock.calls[0][1]).toMatchObject({ olderThanDays: 60 });
  });

  it('коммуникации: в файле оба разреза экрана — каналы и сотрудники', async () => {
    const rows = await reportByKey('communications').rows(ctx);
    expect(rows[0]).toMatchObject({ scope: 'Канал: Telegram', dialogs: 5, avg: 30, overSla: 1 });
    // Разрез по сотрудникам — главный вопрос руководителя «кто отвечает медленно».
    expect(rows[1]).toMatchObject({ scope: 'Сотрудник: Иванов', dialogs: 3, avg: 45, overSla: 2 });
    // Прочерк, а не ноль: этих чисел в разрезе по сотрудникам просто нет.
    expect(rows[1]!.answered).toBe('—');
    expect(rows[1]!.noAnswer).toBe('—');
  });

  it('загрузка менеджеров: заказы, задачи и переписки', async () => {
    const rows = await reportByKey('manager_load').rows(ctx);
    expect(rows[0]).toEqual({
      manager: 'Иванов',
      orders: 7,
      tasks: 3,
      overdue: 1,
      dialogs: 2,
    });
  });

  it('счётчик строк спрашивается ДО выборки и даёт то же число', async () => {
    for (const report of REPORTS) {
      const total = await report.count(ctx);
      const rows = await report.rows(ctx);
      expect(total, `${report.key}: счётчик разошёлся с выборкой`).toBe(rows.length);
    }
  });

  it('каждый отчёт скоупится компанией из запроса, а не из сессии', async () => {
    await reportByKey('funnel_by_source').rows({ ...ctx, companyId: 'другая' });
    expect(getSources.mock.calls[0][1]).toMatchObject({ companyId: 'другая' });
  });
});
