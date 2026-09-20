import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Краевые значения в строках отчётов (`У-244`, `У-247`).
 *
 * Отчёт человек открывает в Excel и считает по нему деньги. Поэтому «нет
 * данных» обязано выглядеть как **прочерк, а не ноль**: ноль читается как
 * «ответили ноль раз» или «должен ноль», и это неправда — данных просто нет.
 *
 * Отдельно — суммы. В базе они лежат строками (`Decimal`), и в Excel должны
 * попасть ЧИСЛАМИ, иначе по колонке не посчитать итог. Нечитаемая строка даёт
 * ноль, а не `NaN`: `NaN` в ячейке ломает всю формулу столбца.
 */
const services = vi.hoisted(() => ({
  getReceivables: vi.fn(),
  getCommunications: vi.fn(),
  getSources: vi.fn(),
  getPartnersAnalytics: vi.fn(),
  getManagerLoad: vi.fn(),
  getKpiPlanFact: vi.fn(),
}));

vi.mock('@/lib/services/leader/receivables', () => ({ getReceivables: services.getReceivables }));
vi.mock('@/lib/services/leader/communications', () => ({
  getCommunications: services.getCommunications,
}));
vi.mock('@/lib/services/leader/sources', () => ({ getSources: services.getSources }));
vi.mock('@/lib/services/leader/partnersAnalytics', () => ({
  getPartnersAnalytics: services.getPartnersAnalytics,
}));
vi.mock('@/lib/services/leader/managerLoad', () => ({ getManagerLoad: services.getManagerLoad }));
vi.mock('@/lib/kpi/plan', () => ({ getKpiPlanFact: services.getKpiPlanFact }));

import { REPORTS, type ReportContext, type ReportKey } from '@/lib/reports/registry';

const ctx: ReportContext = {
  prisma: {} as PrismaClient,
  session: { sub: 'l1', role: 'leader', companyId: 'c1' } as unknown as SessionPayload,
  companyId: 'c1',
  year: 2026,
  month: 9,
  olderThanDays: 0,
};

/** Строки отчёта по его ключу — реестр и есть единственная дверь. */
const rowsOf = (key: ReportKey) => REPORTS.find((r) => r.key === key)!.rows(ctx);

beforeEach(() => vi.clearAllMocks());

describe('Дебиторка', () => {
  it('нет срока и нет ответственного — прочерк, а не пустая ячейка', async () => {
    services.getReceivables.mockResolvedValue({
      rows: [
        {
          organizationName: 'ООО Ромашка',
          billed: '1500.00',
          paid: '400.00',
          debt: '1100.00',
          oldestDays: null,
          managerName: null,
        },
      ],
    });

    const rows = await rowsOf('receivables');

    expect(rows[0]).toMatchObject({ days: '—', manager: '—' });
    // Суммы — числами: иначе по колонке не посчитать итог в Excel.
    expect(rows[0]).toMatchObject({ billed: 1500, paid: 400, debt: 1100 });
  });

  it('нечитаемая сумма даёт ноль, а не NaN — иначе сломается вся колонка', async () => {
    services.getReceivables.mockResolvedValue({
      rows: [
        {
          organizationName: 'ООО Ромашка',
          billed: 'нет данных',
          paid: '',
          debt: '100.00',
          oldestDays: 30,
          managerName: 'Иванов',
        },
      ],
    });

    const rows = await rowsOf('receivables');

    expect(rows[0]!.billed).toBe(0);
    expect(Number.isNaN(rows[0]!.billed)).toBe(false);
    expect(rows[0]).toMatchObject({ days: 30, manager: 'Иванов' });
  });
});

describe('Воронка по источникам', () => {
  it('конверсию посчитать не из чего — прочерк, а не ноль процентов', async () => {
    services.getSources.mockResolvedValue({
      leads: [{ label: 'Сайт', leads: 0, deals: 0, orders: 0, conversionPct: null }],
    });

    const rows = await rowsOf('funnel_by_source');

    // Ноль прочитали бы как «ни один лид не дошёл», а лидов вообще не было.
    expect(rows[0]).toMatchObject({ source: 'Сайт', conversion: '—' });
  });

  it('конверсия есть — уходит числом', async () => {
    services.getSources.mockResolvedValue({
      leads: [{ label: 'Звонок', leads: 10, deals: 4, orders: 2, conversionPct: 20 }],
    });

    expect((await rowsOf('funnel_by_source'))[0]).toMatchObject({ conversion: 20 });
  });
});

describe('Коммуникации', () => {
  it('среднего времени ответа нет — прочерк в обоих разрезах', async () => {
    services.getCommunications.mockResolvedValue({
      byChannel: [
        {
          channelLabel: 'Телеграм',
          dialogs: 1,
          answered: 0,
          avgFirstResponseMin: null,
          overSla: 0,
          waitingNoAnswer: 1,
        },
      ],
      byManager: [{ managerName: 'Иванов', dialogs: 2, avgFirstResponseMin: null, overSla: 1 }],
    });

    const rows = await rowsOf('communications');

    expect(rows[0]).toMatchObject({ scope: 'Канал: Телеграм', avg: '—' });
    expect(rows[1]).toMatchObject({ scope: 'Сотрудник: Иванов', avg: '—' });
    // У разреза по сотрудникам этих чисел нет вовсе — прочерк честнее нуля,
    // который прочитали бы как «никому не ответил».
    expect(rows[1]).toMatchObject({ answered: '—', noAnswer: '—' });
  });

  it('время ответа есть — уходит числом минут', async () => {
    services.getCommunications.mockResolvedValue({
      byChannel: [
        {
          channelLabel: 'Почта',
          dialogs: 5,
          answered: 5,
          avgFirstResponseMin: 12,
          overSla: 0,
          waitingNoAnswer: 0,
        },
      ],
      byManager: [{ managerName: 'Петров', dialogs: 3, avgFirstResponseMin: 7, overSla: 0 }],
    });

    const rows = await rowsOf('communications');

    expect(rows[0]).toMatchObject({ avg: 12 });
    expect(rows[1]).toMatchObject({ avg: 7 });
  });
});
