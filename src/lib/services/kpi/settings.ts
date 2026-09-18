import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader } from '@/lib/auth/roleModel';
import { recordAudit } from '@/lib/auth/audit';
import {
  MAX_ACTIVE_METRICS,
  isKpiMetricKey,
  kpiMetric,
  resolveActiveMetrics,
  type KpiMetricKey,
} from '@/lib/kpi/metrics';

/**
 * Настройка показателей компании (`У-242`, этап 7).
 *
 * Права — администратор или руководитель своей компании. Проверка стоит здесь,
 * а не только на странице: скрытая карточка — это внешний вид, а не защита
 * (§4, defense-in-depth).
 *
 * Планы хранятся в `SalesTarget` строкой на пару «показатель × ответственный»;
 * строка с пустым ответственным — план на компанию целиком (`Р-Э7-3`).
 */
export type KpiSettingsError = 'forbidden' | 'invalid' | 'too_many' | 'not_found';

const MAX_TARGET = new Prisma.Decimal('1e12');

function guard(session: SessionPayload): { ok: true; companyId: string } | { ok: false } {
  const allowed = session.role === 'admin' || isManagerLeader(session);
  if (!allowed || !session.companyId) return { ok: false };
  return { ok: true, companyId: session.companyId };
}

export type KpiSettingsView = {
  /** Все показатели реестра — чтобы человек видел, из чего выбирает. */
  available: Array<{
    key: KpiMetricKey;
    label: string;
    hint: string;
    unit: string;
    perManager: boolean;
  }>;
  active: KpiMetricKey[];
  managers: Array<{ id: string; name: string; isActive: boolean }>;
  /** `metric:managerId` (пустой managerId — план компании) → сумма плана. */
  targets: Record<string, string>;
  year: number;
  month: number;
};

export async function getKpiSettings(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { year: number; month: number }
): Promise<{ ok: true; view: KpiSettingsView } | { ok: false; error: KpiSettingsError }> {
  const g = guard(session);
  if (!g.ok) return { ok: false, error: 'forbidden' };

  const [company, managers, targets] = await Promise.all([
    prisma.company.findUnique({
      where: { id: g.companyId },
      select: { activeKpiMetrics: true },
    }),
    prisma.user.findMany({
      where: { companyId: g.companyId, role: { in: ['manager', 'leader'] } },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    prisma.salesTarget.findMany({
      where: { companyId: g.companyId, year: args.year, month: args.month },
      select: { managerId: true, metric: true, targetAmount: true },
    }),
  ]);
  if (!company) return { ok: false, error: 'not_found' };

  const map: Record<string, string> = {};
  for (const t of targets) map[`${t.metric}:${t.managerId ?? ''}`] = t.targetAmount.toFixed(2);

  return {
    ok: true,
    view: {
      available: [...KPI_KEYS].map((key) => {
        const m = kpiMetric(key);
        return {
          key: m.key,
          label: m.label,
          hint: m.hint,
          unit: m.unit,
          perManager: m.perManager,
        };
      }),
      active: resolveActiveMetrics(company.activeKpiMetrics),
      managers: managers.map((m) => ({
        id: m.id,
        name: m.name || m.email,
        isActive: m.isActive,
      })),
      targets: map,
      year: args.year,
      month: args.month,
    },
  };
}

/** Порядок в реестре — он же порядок выбора на экране. */
const KPI_KEYS: KpiMetricKey[] = [
  'revenue_paid',
  'orders_created',
  'leads_created',
  'proposals_sent',
  'deals_won',
  'calls_outbound',
  'dialogs_answered',
  'avg_first_response_min',
  'tasks_overdue',
  'certificates_issued',
];

export async function setActiveMetrics(
  prisma: PrismaClient,
  session: SessionPayload,
  keys: string[]
): Promise<{ ok: true } | { ok: false; error: KpiSettingsError }> {
  const g = guard(session);
  if (!g.ok) return { ok: false, error: 'forbidden' };

  const clean = keys.filter(isKpiMetricKey);
  // Незнакомый ключ — не «пропустим молча»: человек выбрал не то, и он должен
  // это увидеть, иначе показатель тихо не появится на дашборде.
  if (clean.length !== keys.length) return { ok: false, error: 'invalid' };
  if (new Set(clean).size !== clean.length) return { ok: false, error: 'invalid' };
  if (clean.length > MAX_ACTIVE_METRICS) return { ok: false, error: 'too_many' };

  const before = await prisma.company.findUnique({
    where: { id: g.companyId },
    select: { activeKpiMetrics: true },
  });
  if (!before) return { ok: false, error: 'not_found' };

  await prisma.company.update({
    where: { id: g.companyId },
    data: { activeKpiMetrics: clean },
  });
  await recordAudit(prisma, {
    action: 'kpi_metrics_changed',
    entity: 'company',
    entityId: g.companyId,
    userId: session.sub,
    before: { activeKpiMetrics: before.activeKpiMetrics },
    after: { activeKpiMetrics: clean },
  });
  return { ok: true };
}

export type UpsertKpiTargetArgs = {
  metric: string;
  /** `null` — план на компанию целиком. */
  managerId: string | null;
  year: number;
  month: number;
  /** `null` — убрать план. */
  amount: string | null;
};

export async function upsertKpiTarget(
  prisma: PrismaClient,
  session: SessionPayload,
  args: UpsertKpiTargetArgs
): Promise<{ ok: true } | { ok: false; error: KpiSettingsError }> {
  const g = guard(session);
  if (!g.ok) return { ok: false, error: 'forbidden' };
  if (!isKpiMetricKey(args.metric)) return { ok: false, error: 'invalid' };
  if (!Number.isInteger(args.year) || args.year < 2000 || args.year > 2100)
    return { ok: false, error: 'invalid' };
  if (!Number.isInteger(args.month) || args.month < 1 || args.month > 12)
    return { ok: false, error: 'invalid' };

  const metric = kpiMetric(args.metric);
  // Показателю без ответственного план по менеджеру не ставится — иначе в
  // отчёте появится план, который нечем закрыть.
  if (!metric.perManager && args.managerId !== null) return { ok: false, error: 'invalid' };

  if (args.managerId) {
    // Кросс-компания: план можно ставить только своему сотруднику.
    const manager = await prisma.user.findUnique({
      where: { id: args.managerId },
      select: { companyId: true },
    });
    if (!manager) return { ok: false, error: 'not_found' };
    if (manager.companyId !== g.companyId) return { ok: false, error: 'forbidden' };
  }

  const where = {
    companyId: g.companyId,
    managerId: args.managerId,
    year: args.year,
    month: args.month,
    metric: args.metric,
  };

  if (args.amount === null) {
    await prisma.salesTarget.deleteMany({ where });
    await recordAudit(prisma, {
      action: 'kpi_target_changed',
      entity: 'company',
      entityId: g.companyId,
      userId: session.sub,
      after: { ...where, targetAmount: null },
    });
    return { ok: true };
  }

  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(args.amount);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  // `Decimal('NaN')` разбирается без исключения, а сравнения с NaN всегда
  // ложны — без явной проверки такая строка прошла бы оба условия ниже.
  if (!amount.isFinite() || amount.lte(0) || amount.gte(MAX_TARGET))
    return { ok: false, error: 'invalid' };

  // `upsert` тут не годится: составной ключ с пустым ответственным Prisma не
  // принимает, а частичный индекс держит единственность на стороне базы.
  const existing = await prisma.salesTarget.findFirst({ where, select: { id: true } });
  if (existing) {
    await prisma.salesTarget.update({ where: { id: existing.id }, data: { targetAmount: amount } });
  } else {
    await prisma.salesTarget.create({
      data: { ...where, targetAmount: amount, createdById: session.sub },
    });
  }

  await recordAudit(prisma, {
    action: 'kpi_target_changed',
    entity: 'company',
    entityId: g.companyId,
    userId: session.sub,
    after: { ...where, targetAmount: amount.toFixed(2) },
  });
  return { ok: true };
}

/**
 * Копирование планов с прошлого месяца: экономит руководителю полчаса ручного
 * ввода в начале каждого месяца. Уже заданные планы текущего месяца **не
 * перетираются** — иначе кнопка стала бы разрушительной, а отменить её нечем.
 */
export async function copyTargetsFromPreviousMonth(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { year: number; month: number }
): Promise<{ ok: true; copied: number } | { ok: false; error: KpiSettingsError }> {
  const g = guard(session);
  if (!g.ok) return { ok: false, error: 'forbidden' };
  if (!Number.isInteger(args.year) || !Number.isInteger(args.month)) {
    return { ok: false, error: 'invalid' };
  }

  const prevMonth = args.month === 1 ? 12 : args.month - 1;
  const prevYear = args.month === 1 ? args.year - 1 : args.year;

  const [previous, current] = await Promise.all([
    prisma.salesTarget.findMany({
      where: { companyId: g.companyId, year: prevYear, month: prevMonth },
      select: { managerId: true, metric: true, targetAmount: true },
    }),
    prisma.salesTarget.findMany({
      where: { companyId: g.companyId, year: args.year, month: args.month },
      select: { managerId: true, metric: true },
    }),
  ]);

  const taken = new Set(current.map((t) => `${t.metric}:${t.managerId ?? ''}`));
  const rows = previous.filter((t) => !taken.has(`${t.metric}:${t.managerId ?? ''}`));
  if (rows.length > 0) {
    await prisma.salesTarget.createMany({
      data: rows.map((t) => ({
        companyId: g.companyId,
        managerId: t.managerId,
        year: args.year,
        month: args.month,
        metric: t.metric,
        targetAmount: t.targetAmount,
        createdById: session.sub,
      })),
    });
  }

  await recordAudit(prisma, {
    action: 'kpi_target_changed',
    entity: 'company',
    entityId: g.companyId,
    userId: session.sub,
    after: {
      copiedFrom: `${prevYear}-${prevMonth}`,
      to: `${args.year}-${args.month}`,
      count: rows.length,
    },
  });
  return { ok: true, copied: rows.length };
}
