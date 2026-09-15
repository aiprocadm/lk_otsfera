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
import { startOfMoscowDay } from '@/lib/dates/calendar';
import { DIALOG_STATUS } from '@/lib/services/messengers/dialogStatus';
import { NO_COMPANY_SENTINEL } from '@/lib/auth/accessProfile';
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
  /**
   * `У-226` (этап 4). Четыре вещи, которых в «Моём дне» не хватало: переписка,
   * где клиент ждёт ответа именно от меня; коммерческие предложения, у которых
   * срок вот-вот истечёт; сколько шагов чек-листов осталось в моих задачах;
   * события календаря на сегодня.
   */
  dialogsWaiting: number;
  proposalsExpiring: number;
  checklistOpen: number;
  eventsToday: number;
};

/** Сколько дней считаем «срок вот-вот истечёт» у коммерческого предложения. */
const PROPOSAL_SOON_DAYS = 3;

/**
 * Границы «сегодня» — по московскому календарю (`Д-22`, хотфикс №21).
 *
 * Раньше здесь стоял `setHours(0, 0, 0, 0)` с комментарием «локальное время
 * сервера (МСК на стенде)» — но серверы живут в UTC, и с 00:00 до 03:00 МСК
 * «сегодня» уезжало на вчерашний день: менеджер в начале ночной смены видел
 * вчерашние дела.
 */
function dayBounds(now: Date): { start: Date; end: Date } {
  const start = startOfMoscowDay(now);
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
  // evaluateReadinessBatch — это orders.map(): длины массивов совпадают.
  const ready = orders.filter((_, i) => readiness[i]!.ready);
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

  const soon = new Date(now.getTime() + PROPOSAL_SOON_DAYS * ONE_DAY_MS);

  const [
    tasksToday,
    tasksOverdue,
    intake,
    ready,
    dealsGrouped,
    inboundFresh,
    callsMissed,
    dialogsWaiting,
    proposalsExpiring,
    checklistOpen,
    eventsToday,
  ] = await Promise.all([
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
    // `У-226`: переписка ждёт ответа. Считаем МОИ диалоги — те, где я
    // ответственный: общая очередь ничейных это работа дежурного, а не моя
    // личная сводка.
    prisma.messengerDialog.count({
      where: {
        companyId: session.companyId ?? NO_COMPANY_SENTINEL,
        assigneeId: session.sub,
        status: DIALOG_STATUS.waitingStaff,
      },
    }),
    // КП, у которых срок кончается в ближайшие дни. Уже истёкшие сюда не
    // попадают: по ним решение принято, и напоминать о них поздно.
    prisma.document.count({
      where: {
        companyId: session.companyId ?? NO_COMPANY_SENTINEL,
        type: 'commercial_proposal',
        status: 'sent',
        validUntil: { gte: now, lt: soon },
      },
    }),
    // Невыполненные шаги в моих незавершённых задачах — «сколько мелочи
    // осталось», а не «сколько задач».
    prisma.taskChecklistItem.count({
      where: {
        isDone: false,
        task: {
          AND: [taskFiltersWhere(session, { scope: 'mine' }, now), { status: { not: 'done' } }],
        },
      },
    }),
    // События календаря на сегодня — мои и те, куда меня позвали.
    prisma.calendarEvent.count({
      where: {
        startsAt: { gte: start, lt: end },
        OR: [{ createdById: session.sub }, { attendees: { some: { userId: session.sub } } }],
      },
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
    dialogsWaiting,
    proposalsExpiring,
    checklistOpen,
    eventsToday,
  };
}
