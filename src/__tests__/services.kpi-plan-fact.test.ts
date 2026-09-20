import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * План/факт по показателям компании (`У-242`, этап 7).
 *
 * Реестр показателей подменён: тест про **сборку строк**, а не про то, как
 * считается каждая метрика (у метрик свои тесты). Подмена даёт управляемые
 * `perManager`, `compute` и набор активных ключей — иначе пришлось бы
 * подделывать половину базы, чтобы дойти до одной ветки.
 */
const { resolveActiveMetrics, kpiMetric } = vi.hoisted(() => ({
  resolveActiveMetrics: vi.fn(),
  kpiMetric: vi.fn(),
}));

vi.mock('@/lib/kpi/metrics', () => ({ resolveActiveMetrics, kpiMetric }));

import { getKpiPlanFact } from '@/lib/kpi/plan';
import { moscowMonthRange } from '@/lib/dates/calendar';

const dec = (n: number) => new Prisma.Decimal(n);

type Fact = { total: string; byManager: Map<string, string> };

/**
 * Метрика-заглушка: `compute` отдаёт факт текущего месяца или прошлого.
 *
 * Различаем периоды **по самой дате начала**, а не по `toISOString()`: месяц
 * по Москве начинается в предыдущих сутках по Гринвичу, и строка «2026-09»
 * у сентябрьского диапазона выглядит как «2026-08». На этом тест и споткнулся
 * с первого раза.
 */
function metric(
  key: string,
  perManager: boolean,
  at: { year: number; month: number; current: Fact; previous: Fact }
) {
  const cur = moscowMonthRange(at.year, at.month).from.getTime();
  return {
    key,
    label: `Показатель ${key}`,
    unit: 'count' as const,
    perManager,
    managerHref: '/manager',
    hint: '',
    compute: vi.fn(async (_p: unknown, args: { from: Date; to: Date }) =>
      args.from.getTime() === cur ? at.current : at.previous
    ),
  };
}

function makeDb(opts: {
  company?: { activeKpiMetrics: string[] } | null;
  managers?: Array<{ id: string; name: string; email: string; isActive: boolean }>;
  targets?: Array<{ managerId: string | null; metric: string; targetAmount: Prisma.Decimal }>;
}) {
  return {
    company: { findUnique: vi.fn(async () => opts.company ?? null) },
    user: { findMany: vi.fn(async () => opts.managers ?? []) },
    salesTarget: { findMany: vi.fn(async () => opts.targets ?? []) },
  } as never;
}

describe('getKpiPlanFact — план и факт по показателям', () => {
  it('строит строку на каждого менеджера и итог по команде; процент считается от плана', async () => {
    resolveActiveMetrics.mockReturnValue(['deals']);
    kpiMetric.mockReturnValue(
      metric('deals', true, {
        year: 2026,
        month: 9,
        current: { total: '30', byManager: new Map([['m1', '20']]) },
        previous: { total: '10', byManager: new Map([['m1', '7']]) },
      })
    );

    const db = makeDb({
      company: { activeKpiMetrics: ['deals'] },
      managers: [
        { id: 'm1', name: 'Иванов', email: 'i@x.ru', isActive: true },
        { id: 'm2', name: '', email: 'p@x.ru', isActive: false },
      ],
      targets: [
        { managerId: 'm1', metric: 'deals', targetAmount: dec(40) },
        { managerId: null, metric: 'deals', targetAmount: dec(60) },
      ],
    });

    const res = await getKpiPlanFact(db, { companyId: 'c1', year: 2026, month: 9 });

    expect(res.year).toBe(2026);
    expect(res.month).toBe(9);
    expect(res.metrics).toEqual([
      { key: 'deals', label: 'Показатель deals', unit: 'count', perManager: true },
    ]);
    expect(res.rows).toHaveLength(3);

    const [first, second, total] = res.rows;
    // План задан → процент считается.
    expect(first).toMatchObject({
      managerId: 'm1',
      managerName: 'Иванов',
      plan: '40.00',
      fact: '20',
      percent: 50,
      prevFact: '7',
    });
    // Уволенный остаётся в отчёте с пометкой; имени нет — показывается почта.
    expect(second).toMatchObject({
      managerId: 'm2',
      managerName: 'p@x.ru (не работает)',
      plan: null,
      fact: '0',
      percent: null,
      prevFact: '0',
    });
    expect(total).toMatchObject({
      managerId: null,
      managerName: 'Итого по команде',
      plan: '60.00',
      fact: '30',
      percent: 50,
      prevFact: '10',
    });
  });

  it('показатель без ответственного даёт одну строку «По компании»', async () => {
    resolveActiveMetrics.mockReturnValue(['revenue']);
    kpiMetric.mockReturnValue(
      metric('revenue', false, {
        year: 2026,
        month: 9,
        current: { total: '100', byManager: new Map() },
        previous: { total: '90', byManager: new Map() },
      })
    );

    const db = makeDb({
      company: { activeKpiMetrics: ['revenue'] },
      managers: [{ id: 'm1', name: 'Иванов', email: 'i@x.ru', isActive: true }],
    });

    const res = await getKpiPlanFact(db, { companyId: 'c1', year: 2026, month: 9 });

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ managerId: null, managerName: 'По компании', plan: null });
  });

  it('январь сравнивается с декабрём прошлого года', async () => {
    resolveActiveMetrics.mockReturnValue(['deals']);
    const m = metric('deals', false, {
      year: 2026,
      month: 1,
      current: { total: '5', byManager: new Map() },
      previous: { total: '4', byManager: new Map() },
    });
    kpiMetric.mockReturnValue(m);

    const res = await getKpiPlanFact(makeDb({ company: { activeKpiMetrics: ['deals'] } }), {
      companyId: 'c1',
      year: 2026,
      month: 1,
    });

    expect(res.rows[0]).toMatchObject({ fact: '5', prevFact: '4' });
  });

  it('компании нет — берётся набор показателей по умолчанию', async () => {
    resolveActiveMetrics.mockReturnValue([]);
    const db = makeDb({ company: null });

    const res = await getKpiPlanFact(db, { companyId: 'нет', year: 2026, month: 9 });

    expect(resolveActiveMetrics).toHaveBeenCalledWith([]);
    expect(res.rows).toEqual([]);
    expect(res.metrics).toEqual([]);
  });

  it('нулевой и нечисловой план не дают процента — делить не на что', async () => {
    resolveActiveMetrics.mockReturnValue(['deals']);
    kpiMetric.mockReturnValue(
      metric('deals', false, {
        year: 2026,
        month: 9,
        current: { total: '7', byManager: new Map() },
        previous: { total: '0', byManager: new Map() },
      })
    );

    const zero = await getKpiPlanFact(
      makeDb({
        company: { activeKpiMetrics: ['deals'] },
        targets: [{ managerId: null, metric: 'deals', targetAmount: dec(0) }],
      }),
      { companyId: 'c1', year: 2026, month: 9 }
    );
    expect(zero.rows[0]?.percent).toBeNull();

    // `toFixed` у Decimal даёт строку; подделываем «не число», чтобы пройти
    // ветку `Number.isFinite` — на живой базе туда ведёт испорченная строка.
    const broken = await getKpiPlanFact(
      makeDb({
        company: { activeKpiMetrics: ['deals'] },
        targets: [
          {
            managerId: null,
            metric: 'deals',
            targetAmount: { toFixed: () => 'не число' } as unknown as Prisma.Decimal,
          },
        ],
      }),
      { companyId: 'c1', year: 2026, month: 9 }
    );
    expect(broken.rows[0]?.percent).toBeNull();
    expect(broken.rows[0]?.plan).toBe('не число');
  });
});
