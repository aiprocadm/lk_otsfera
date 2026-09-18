import type { PrismaClient } from '@prisma/client';
import { moscowMonthRange } from '@/lib/dates/calendar';
import {
  kpiMetric,
  resolveActiveMetrics,
  type KpiMetricKey,
  type KpiUnit,
} from '@/lib/kpi/metrics';

/**
 * «Мои KPI за месяц» на дашборде менеджера (`У-245`, этап 7).
 *
 * Показываются активные показатели компании — те же, что у руководителя во
 * вкладке «План и факт», — но **только своё значение** (`У-249`). Чужие цифры
 * сюда не попадают: из общего расчёта берётся ровно одна ячейка по своему
 * идентификатору.
 *
 * Показатели без ответственного (`perManager: false`) пропускаются: «мой»
 * удостоверений не бывает, а плитка с общей цифрой под заголовком «Мои KPI»
 * читалась бы как личный результат.
 *
 * Прошлый месяц здесь НЕ считается (в отличие от `getKpiPlanFact`): дашборд
 * открывают десятки раз в день, и второй проход по всем показателям удваивает
 * цену экрана ради стрелки, которой на плитке всё равно нет места.
 */
export type MyKpiRow = {
  metric: KpiMetricKey;
  label: string;
  unit: KpiUnit;
  /** Мой факт за месяц. */
  fact: string;
  /** Мой план; `null` — плана не ставили. */
  plan: string | null;
  /** Процент выполнения; `null`, если плана нет. */
  percent: number | null;
  /** Куда ведёт плитка — из реестра показателей. */
  href: string;
};

function percentOf(plan: string | null, fact: string): number | null {
  if (plan === null) return null;
  const planNum = Number(plan);
  // Ноль в плане — это «не задано числом», а не «выполнено на бесконечность».
  if (!Number.isFinite(planNum) || planNum === 0) return null;
  return Math.round((Number(fact) / planNum) * 100);
}

export async function getMyKpi(
  prisma: PrismaClient,
  args: { companyId: string; managerId: string; year: number; month: number }
): Promise<MyKpiRow[]> {
  const { companyId, managerId, year, month } = args;
  const period = moscowMonthRange(year, month);

  const [company, targets] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { activeKpiMetrics: true } }),
    prisma.salesTarget.findMany({
      where: { companyId, year, month, managerId },
      select: { metric: true, targetAmount: true },
    }),
  ]);

  const active = resolveActiveMetrics(company?.activeKpiMetrics ?? []).filter(
    (key) => kpiMetric(key).perManager
  );
  const planByMetric = new Map(targets.map((t) => [t.metric, t.targetAmount.toFixed(2)]));

  const rows: MyKpiRow[] = [];
  for (const key of active) {
    const metric = kpiMetric(key);
    const fact = await metric.compute(prisma, { companyId, ...period });
    // Ровно своя ячейка. Нет строки — значит за месяц ничего не было: ноль, а
    // не пустота, иначе плитка выглядела бы сломанной.
    const value = fact.byManager.get(managerId) ?? '0';
    const plan = planByMetric.get(key) ?? null;
    rows.push({
      metric: key,
      label: metric.label,
      unit: metric.unit,
      fact: value,
      plan,
      percent: percentOf(plan, value),
      href: metric.managerHref,
    });
  }

  return rows;
}
