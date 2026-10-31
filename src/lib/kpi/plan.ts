import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { moscowMonthRange } from '@/lib/dates/calendar';
import {
  kpiMetric,
  resolveActiveMetrics,
  type KpiMetric,
  type KpiMetricKey,
  type KpiUnit,
} from '@/lib/kpi/metrics';

/**
 * План и факт по активным показателям компании (`У-242`, этап 7).
 *
 * Одна строка на пару «менеджер × показатель» плюс итог по команде. Процент
 * выполнения считается только когда план задан: делить на ноль и показывать
 * «0 %» там, где плана просто нет, — значит обвинять человека в невыполнении
 * того, чего ему не ставили.
 *
 * Сравнение с прошлым месяцем берётся тем же расчётом за предыдущий период:
 * отдельной таблицы «история KPI» не заводим — она разошлась бы с фактом при
 * первом же исправлении данных задним числом.
 */
export type KpiPlanFactRow = {
  metric: KpiMetricKey;
  metricLabel: string;
  unit: KpiUnit;
  /** `null` — строка итога по команде. */
  managerId: string | null;
  managerName: string;
  /** `null` — план не задан. */
  plan: string | null;
  fact: string;
  /** Процент выполнения; `null`, если плана нет. */
  percent: number | null;
  /** Факт за прошлый месяц — для стрелки «лучше/хуже». */
  prevFact: string;
};

export type KpiPlanFactResult = {
  year: number;
  month: number;
  /** Активные показатели компании в порядке показа. */
  metrics: Array<{ key: KpiMetricKey; label: string; unit: KpiUnit; perManager: boolean }>;
  rows: KpiPlanFactRow[];
};

function percentOf(plan: string | null, fact: string): number | null {
  if (plan === null) return null;
  const planNum = Number(plan);
  if (!Number.isFinite(planNum) || planNum === 0) return null;
  return Math.round((Number(fact) / planNum) * 100);
}

export async function getKpiPlanFact(
  prisma: PrismaClient,
  args: { companyId: string; year: number; month: number }
): Promise<KpiPlanFactResult> {
  const { companyId, year, month } = args;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { activeKpiMetrics: true },
  });
  const active = resolveActiveMetrics(company?.activeKpiMetrics ?? []);

  const current = moscowMonthRange(year, month);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const previous = moscowMonthRange(prevYear, prevMonth);

  const [managers, targets] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, role: { in: ['manager', 'leader'] } },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    prisma.salesTarget.findMany({
      where: { companyId, year, month, metric: { in: active } },
      select: { managerId: true, metric: true, targetAmount: true },
    }),
  ]);

  // Факт считается по одному запросу на показатель — не по одному на человека.
  const facts = new Map<KpiMetricKey, Awaited<ReturnType<KpiMetric['compute']>>>();
  const prevFacts = new Map<KpiMetricKey, Awaited<ReturnType<KpiMetric['compute']>>>();
  for (const key of active) {
    const metric = kpiMetric(key);
    facts.set(key, await metric.compute(prisma, { companyId, ...current }));
    prevFacts.set(key, await metric.compute(prisma, { companyId, ...previous }));
  }

  const planByKey = new Map<string, string>();
  // Пустой ответственный — план на компанию целиком; ключ у него без хвоста,
  // иначе строка легла бы под «metric:null» и не нашлась бы ни разу.
  for (const t of targets)
    planByKey.set(`${t.metric}:${t.managerId ?? ''}`, t.targetAmount.toFixed(2));

  const rows: KpiPlanFactRow[] = [];
  for (const key of active) {
    const metric = kpiMetric(key);
    const fact = facts.get(key)!;
    const prev = prevFacts.get(key)!;

    if (metric.perManager) {
      for (const m of managers) {
        const plan = planByKey.get(`${key}:${m.id}`) ?? null;
        const value = fact.byManager.get(m.id) ?? '0';
        rows.push({
          metric: key,
          metricLabel: metric.label,
          unit: metric.unit,
          managerId: m.id,
          // Уволенный остаётся в отчёте с пометкой (`В-7-6`): иначе прошлые
          // цифры перестают сходиться с итогом.
          managerName: `${m.name || m.email}${m.isActive ? '' : ' (не работает)'}`,
          plan,
          fact: value,
          percent: percentOf(plan, value),
          prevFact: prev.byManager.get(m.id) ?? '0',
        });
      }
    }

    // `У-334` (`Д-68`, ТЗ 28.10.2026): руководитель задаёт план каждому
    // менеджеру, а отдельного плана «на команду» нет — и «Итого по команде»
    // показывало прочерк, хотя таблица планов ниже уже сложила их в «Итого».
    // Явный план на команду главнее; без него — сумма планов менеджеров.
    const teamPlan = planByKey.get(`${key}:`) ?? null;
    const managersPlans = metric.perManager
      ? managers
          .map((m) => planByKey.get(`${key}:${m.id}`))
          .filter((v): v is string => v !== undefined)
      : [];
    const totalPlan =
      teamPlan ??
      (managersPlans.length
        ? managersPlans.reduce((s, v) => s.plus(v), new Prisma.Decimal(0)).toFixed(2)
        : null);
    rows.push({
      metric: key,
      metricLabel: metric.label,
      unit: metric.unit,
      managerId: null,
      managerName: metric.perManager ? 'Итого по команде' : 'По компании',
      plan: totalPlan,
      fact: fact.total,
      percent: percentOf(totalPlan, fact.total),
      prevFact: prev.total,
    });
  }

  return {
    year,
    month,
    metrics: active.map((key) => {
      const m = kpiMetric(key);
      return { key: m.key, label: m.label, unit: m.unit, perManager: m.perManager };
    }),
    rows,
  };
}
