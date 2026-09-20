import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { KPI_METRICS } from '@/lib/kpi/metrics';

/**
 * СТРАЖ `У-245`/`У-249` (этап 7): «Мои KPI» показывают ТОЛЬКО свои цифры.
 *
 * Блок стоит на дашборде рядового менеджера. Если в него просочится общий итог
 * или чужая ячейка, человек прочитает это как свой результат — и разговор о
 * премии пойдёт по чужому числу.
 *
 * Расчёт самих показателей здесь подменён: проверяется отбор (чья ячейка, чей
 * план, какие показатели вообще «мои»), а не арифметика метрик — она своя у
 * каждой и покрыта отдельно.
 *
 * Мутация (проверено): вернуть `fact.total` вместо `fact.byManager.get(id)` →
 * «чужие цифры не показываются» краснеет; убрать фильтр `perManager` →
 * «показатели без ответственного не попадают в мои» краснеет; убрать
 * `managerId` из запроса планов → «план берётся только свой» краснеет.
 */
const OWN = 'u-own';
const OTHER = 'u-other';

const { kpiMetric } = vi.hoisted(() => ({ kpiMetric: vi.fn() }));
vi.mock('@/lib/kpi/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kpi/metrics')>('@/lib/kpi/metrics');
  return { ...actual, kpiMetric };
});

const { getMyKpi } = await import('@/lib/services/manager/myKpi');

const salesTargetFindMany = vi.fn();
const companyFindUnique = vi.fn();
const prisma = {
  company: { findUnique: companyFindUnique },
  salesTarget: { findMany: salesTargetFindMany },
} as unknown as PrismaClient;

/** Показатель-заглушка: у своего «10», у чужого «777», итог «999». */
function stub(key: string, perManager: boolean) {
  return {
    key,
    label: key,
    unit: 'count' as const,
    perManager,
    hint: '',
    managerHref: '/manager/orders',
    compute: vi.fn(async () => ({
      total: '999',
      byManager: new Map([
        [OWN, '10'],
        [OTHER, '777'],
      ]),
    })),
  };
}

const targetsWhere = () =>
  (salesTargetFindMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;

beforeEach(() => {
  vi.clearAllMocks();
  companyFindUnique.mockResolvedValue({ activeKpiMetrics: ['revenue_paid'] });
  salesTargetFindMany.mockResolvedValue([]);
  kpiMetric.mockImplementation((key: string) => stub(key, true));
});

describe('страж: «Мои KPI» — только свои цифры (У-245, У-249)', () => {
  it('чужая ячейка и общий итог не показываются', async () => {
    const rows = await getMyKpi(prisma, { companyId: 'c1', managerId: OWN, year: 2026, month: 9 });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.fact, 'в «Мои KPI» попала не своя цифра').toBe('10');
    const values = rows.map((r) => r.fact);
    expect(values, 'общий итог компании выдан за личный результат').not.toContain('999');
    expect(values, 'чужая ячейка попала в «мои»').not.toContain('777');
  });

  it('за месяц ничего не было — ноль, а не пустота', async () => {
    kpiMetric.mockImplementation((key: string) => ({
      ...stub(key, true),
      compute: vi.fn(async () => ({ total: '500', byManager: new Map([[OTHER, '500']]) })),
    }));
    const rows = await getMyKpi(prisma, { companyId: 'c1', managerId: OWN, year: 2026, month: 9 });
    expect(rows[0]!.fact).toBe('0');
  });

  it('показатели без ответственного в «мои» не попадают', async () => {
    // У удостоверений ответственного нет (`Р-Э7-3`) — «моих» удостоверений не
    // бывает, а плитка с общей цифрой читалась бы как личный результат.
    companyFindUnique.mockResolvedValue({
      activeKpiMetrics: ['certificates_issued', 'revenue_paid'],
    });
    kpiMetric.mockImplementation((key: string) => stub(key, key !== 'certificates_issued'));

    const rows = await getMyKpi(prisma, { companyId: 'c1', managerId: OWN, year: 2026, month: 9 });
    expect(rows.map((r) => r.metric)).toEqual(['revenue_paid']);
  });

  it('компании нет в базе — показатели по умолчанию, а не падение', async () => {
    // Компанию могли удалить, а сессия сотрудника ещё жива. Набор по
    // умолчанию честнее, чем ошибка на главной странице кабинета: плитки
    // покажут нули, и человек поймёт, что настройки нет.
    companyFindUnique.mockResolvedValue(null);
    const rows = await getMyKpi(prisma, { companyId: 'c1', managerId: OWN, year: 2026, month: 9 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => typeof r.metric === 'string')).toBe(true);
  });

  it('план берётся только свой — запрос ограничен своим идентификатором', async () => {
    await getMyKpi(prisma, { companyId: 'c1', managerId: OWN, year: 2026, month: 9 });
    expect(targetsWhere(), 'план спрашивается без границы по сотруднику').toMatchObject({
      companyId: 'c1',
      managerId: OWN,
      year: 2026,
      month: 9,
    });
  });

  it('план не задан — процента нет, а не ноль', async () => {
    const rows = await getMyKpi(prisma, { companyId: 'c1', managerId: OWN, year: 2026, month: 9 });
    expect(rows[0]!.plan, 'план взялся из ниоткуда').toBeNull();
    expect(rows[0]!.percent, '«0 %» под незаданным планом').toBeNull();
  });

  it('нулевой план не делит на ноль', async () => {
    salesTargetFindMany.mockResolvedValue([
      { metric: 'revenue_paid', targetAmount: { toFixed: () => '0.00' } },
    ]);
    const rows = await getMyKpi(prisma, { companyId: 'c1', managerId: OWN, year: 2026, month: 9 });
    expect(rows[0]!.plan).toBe('0.00');
    expect(rows[0]!.percent).toBeNull();
  });

  it('план задан — считается процент от своего факта', async () => {
    salesTargetFindMany.mockResolvedValue([
      { metric: 'revenue_paid', targetAmount: { toFixed: () => '20.00' } },
    ]);
    const rows = await getMyKpi(prisma, { companyId: 'c1', managerId: OWN, year: 2026, month: 9 });
    expect(rows[0]!.percent).toBe(50);
  });

  it('компания ничего не выбрала — работает прежнее правило, один показатель', async () => {
    companyFindUnique.mockResolvedValue({ activeKpiMetrics: [] });
    const rows = await getMyKpi(prisma, { companyId: 'c1', managerId: OWN, year: 2026, month: 9 });
    expect(rows.map((r) => r.metric)).toEqual(['revenue_paid']);
  });

  it('у каждого показателя реестра есть ссылка в кабинет менеджера', () => {
    for (const metric of KPI_METRICS) {
      expect(metric.managerHref, `${metric.key}: плитка без ссылки — тупик`).toMatch(
        /^\/manager\//
      );
    }
  });
});
