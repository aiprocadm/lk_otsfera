import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { taskFiltersWhere } from '@/lib/services/tasks/board';
import { dealScopeWhere } from '@/lib/services/deals/board';
import { countIntake, intakeInboundWhere, intakeCallWhere } from '@/lib/services/intake/list';
import {
  READINESS_SELECT,
  evaluateReadinessBatch,
  type OrderForReadiness,
} from '@/lib/services/manager/orderDelivery';
import { ONE_DAY_MS } from './dashboard/constants';

/**
 * Этап 11 PR-2 (Модуль 15, ФТ-15.3) — «Мой день» менеджера.
 *
 * Агрегатор поверх **уже существующих** скоупов: задачи (`taskFiltersWhere`),
 * Intake (`countIntake` — тот же union, что у бейджа меню), заказы
 * (`managerOrderScope`, C8), сделки (`dealScopeWhere`). Новых правил видимости
 * здесь не появляется — это витрина, а не новый домен.
 *
 * «Готово к передаче» (решение заказчика §5-2 спеки этапа 11) = чек-лист
 * закрыт **и** кнопка передачи не нажата. Считается той же
 * `evaluateReadinessBatch`, что и блок на деталке заказа (этап 12), — второй
 * реализации правил готовности в проекте нет.
 */

/** Сколько заказов проверяем на готовность за раз (витрина, не отчёт). */
const READINESS_SCAN_CAP = 200;
/** Сколько заказов показываем ссылками в карточке. */
const READY_PREVIEW = 5;

type MyDayDeal = { stageName: string; count: number };

export type MyDayData = {
  tasksToday: number;
  tasksOverdue: number;
  intake: number;
  readyToDeliver: number;
  /** Первые несколько готовых заказов — прямыми ссылками. */
  readyOrders: { id: string; orderNumber: string | null; title: string }[];
  /** true — готовых больше, чем поместилось в превью. */
  readyTruncated: boolean;
  dealsOpen: number;
  dealsByStage: MyDayDeal[];
  inboundFresh: number;
  callsMissed: number;
};

/** Границы «сегодня» по локальному времени сервера (МСК на стенде). */
function dayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + ONE_DAY_MS);
  return { start, end };
}

/**
 * Заказы, готовые к передаче: не переданные и не отменённые (передавать
 * нечего), в скоупе менеджера. Готовность считается в памяти — правила живут в
 * одной чистой функции, дублировать их SQL-ом нельзя.
 */
async function readyToDeliverOrders(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean
): Promise<{ total: number; preview: MyDayData['readyOrders'] }> {
  const orders = await prisma.order.findMany({
    where: {
      AND: [
        managerOrderScope(session, teamMode),
        { resultDeliveredAt: null },
        { executionStatus: { not: 'cancelled' } },
      ],
    },
    select: READINESS_SELECT,
    orderBy: { updatedAt: 'desc' },
    take: READINESS_SCAN_CAP,
  });

  const readiness = await evaluateReadinessBatch(prisma, orders as OrderForReadiness[]);
  const ready = orders.filter((_, i) => readiness[i].ready);
  return {
    total: ready.length,
    preview: ready.slice(0, READY_PREVIEW).map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      title: o.title,
    })),
  };
}

export async function getMyDay(
  prisma: PrismaClient,
  session: SessionPayload,
  teamModeOverride?: boolean,
  nowOverride?: Date
): Promise<MyDayData> {
  const teamMode = teamModeOverride ?? (await getCompanyTeamVisibility(prisma, session.companyId));
  const now = nowOverride ?? new Date();
  const { start, end } = dayBounds(now);
  const dayAgo = new Date(now.getTime() - ONE_DAY_MS);

  const [tasksToday, tasksOverdue, intake, ready, dealsGrouped, inboundFresh, callsMissed] =
    await Promise.all([
      prisma.task.count({
        where: {
          AND: [
            taskFiltersWhere(session, { scope: 'mine' }, now),
            { dueDate: { gte: start, lt: end }, status: { not: 'done' } },
          ],
        },
      }),
      prisma.task.count({
        where: taskFiltersWhere(session, { scope: 'mine', overdue: true }, now),
      }),
      countIntake(prisma, session),
      readyToDeliverOrders(prisma, session, teamMode),
      prisma.deal.groupBy({
        by: ['stageId'],
        where: { AND: [dealScopeWhere(session, { managerId: session.sub }), { status: 'open' }] },
        _count: { _all: true },
      }),
      prisma.inboundMessage.count({
        where: { AND: [intakeInboundWhere(session), { createdAt: { gte: dayAgo } }] },
      }),
      prisma.call.count({
        where: { AND: [intakeCallWhere(session), { startedAt: { gte: dayAgo } }] },
      }),
    ]);

  const stageIds = dealsGrouped.map((g) => g.stageId).filter((id): id is string => id != null);
  const stages = stageIds.length
    ? await prisma.dealStage.findMany({
        where: { id: { in: stageIds } },
        select: { id: true, name: true, position: true },
      })
    : [];
  const stageById = new Map(stages.map((s) => [s.id, s]));

  const dealsByStage: MyDayDeal[] = dealsGrouped
    .map((g) => {
      // stageId=null — сделка на дефолтной стадии status-якоря (см. схему).
      const stage = g.stageId ? stageById.get(g.stageId) : undefined;
      return {
        stageName: stage?.name ?? 'Без стадии',
        position: stage?.position ?? Number.MAX_SAFE_INTEGER,
        count: g._count._all,
      };
    })
    .sort((a, b) => a.position - b.position)
    .map(({ stageName, count }) => ({ stageName, count }));

  return {
    tasksToday,
    tasksOverdue,
    intake,
    readyToDeliver: ready.total,
    readyOrders: ready.preview,
    readyTruncated: ready.total > ready.preview.length,
    dealsOpen: dealsByStage.reduce((sum, s) => sum + s.count, 0),
    dealsByStage,
    inboundFresh,
    callsMissed,
  };
}
