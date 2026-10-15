import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrderScope, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { taskFiltersWhere } from '@/lib/services/tasks/board';
import { dealScopeWhere } from '@/lib/services/deals/board';
import { countIntake, countIntakeSla } from '@/lib/services/intake/list';
import { readyToDeliverOrders } from '@/lib/services/manager/orderFocus';
import { startOfMoscowDay } from '@/lib/dates/calendar';
import { dueWithinDaysWhere } from '@/lib/tasks/due';
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
 * закрыт **и** кнопка передачи не нажата. Считается `readyToDeliverOrders`
 * (`orderFocus.ts`) — тем же, чем фильтруется список «Заказы» по ссылке с
 * карточки (этап 4 ТЗ 13.10.2026, `У-295`): число на карточке = число строк.
 *
 * Этап 4 ТЗ 13.10.2026 (`У-293`, `У-294`, `У-296`): «Поступило» и «Свежие
 * обращения» стали одной карточкой — вся очередь «Входящие в работу» со
 * сроками ответа; «Шагов в чек-листах» убрано.
 */

/** Сколько заказов показываем ссылками в карточке. */
const READY_PREVIEW = 5;

type MyDayDeal = { stageName: string; count: number };

export type MyDayData = {
  tasksToday: number;
  tasksOverdue: number;
  /** Вся очередь «Входящие в работу» — тот же счётчик, что у пункта меню. */
  intake: number;
  /** Из неё: срок ответа наступит в ближайший час / уже прошёл (`У-294`). */
  intakeDueWithinHour: number;
  intakeOverdue: number;
  readyToDeliver: number;
  /** Первые несколько готовых заказов — прямыми ссылками. */
  readyOrders: { id: string; orderNumber: string | null; title: string }[];
  /** true — готовых больше, чем поместилось в превью. */
  readyTruncated: boolean;
  dealsOpen: number;
  dealsByStage: MyDayDeal[];
  /**
   * `У-226` (этап 4 ТЗ 12.09.2026): переписка, где клиент ждёт ответа именно от
   * меня; коммерческие предложения, у которых срок вот-вот истечёт; события
   * календаря на сегодня.
   */
  dialogsWaiting: number;
  proposalsExpiring: number;
  eventsToday: number;
};

/**
 * Сколько дней считаем «срок вот-вот истечёт» у коммерческого предложения:
 * сегодня и ещё три московских дня вперёд.
 */
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

export async function getMyDay(
  prisma: PrismaClient,
  session: SessionPayload,
  teamModeOverride?: boolean,
  nowOverride?: Date
): Promise<MyDayData> {
  const teamMode = teamModeOverride ?? (await getCompanyTeamVisibility(prisma, session.companyId));
  const now = nowOverride ?? new Date();
  const { start, end } = dayBounds(now);

  const [
    tasksToday,
    tasksOverdue,
    intake,
    intakeSla,
    ready,
    dealsGrouped,
    dialogsWaiting,
    proposalsExpiring,
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
    countIntakeSla(prisma, session, now),
    readyToDeliverOrders(prisma, managerOrderScope(session, teamMode)),
    prisma.deal.groupBy({
      by: ['stageId'],
      where: { AND: [dealScopeWhere(session, { managerId: session.sub }), { status: 'open' }] },
      _count: { _all: true },
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
    //
    // Окно — московские дни (прогон №36, `Р-М-3`), а не «от сейчас». КП
    // действует ВЕСЬ последний день (`У-164`, `documents/proposalExpiry.ts`),
    // а срок «только дата» хранится полуночью UTC: условие `>= сейчас` днём
    // выкидывало КП, которое истекает СЕГОДНЯ, — самое срочное из всех.
    prisma.document.count({
      where: {
        companyId: session.companyId ?? NO_COMPANY_SENTINEL,
        type: 'commercial_proposal',
        status: 'sent',
        validUntil: dueWithinDaysWhere(now, PROPOSAL_SOON_DAYS),
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
    intakeDueWithinHour: intakeSla.dueWithinHour,
    intakeOverdue: intakeSla.overdue,
    readyToDeliver: ready.length,
    readyOrders: ready.slice(0, READY_PREVIEW),
    readyTruncated: ready.length > READY_PREVIEW,
    dealsOpen: dealsByStage.reduce((sum, s) => sum + s.count, 0),
    dealsByStage,
    dialogsWaiting,
    proposalsExpiring,
    eventsToday,
  };
}
