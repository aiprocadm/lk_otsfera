import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { leadCompanyWhere } from '@/lib/auth/leadScope';
import { pastDueWhere } from '@/lib/tasks/due';

/**
 * Реестр показателей компании (`У-242`, этап 7 ТЗ 12.09.2026).
 *
 * Зачем реестр, а не пользовательские формулы: требование пакета прямо говорит
 * «отсутствующий показатель — новая метрика в реестре, не пользовательская
 * формула». Формула, набранная руками, ломается молча и неотличимо от данных;
 * запись реестра проверяется тестом и объясняется словами.
 *
 * Каждая метрика умеет одно: посчитать ФАКТ за период по компании, разложив
 * его по ответственным. Один запрос на метрику — никаких выборок в цикле
 * (`У-248`, страж `reports.no-n-plus-one`).
 *
 * `perManager = false` означает «у объекта нет ответственного» — так у
 * удостоверений. Придумывать им менеджера значило бы врать в отчёте, поэтому
 * такая метрика планируется на компанию целиком (`Р-Э7-3`).
 */
export type KpiMetricKey =
  | 'revenue_paid'
  | 'orders_created'
  | 'leads_created'
  | 'proposals_sent'
  | 'deals_won'
  | 'calls_outbound'
  | 'dialogs_answered'
  | 'avg_first_response_min'
  | 'tasks_overdue'
  | 'certificates_issued';

/** Единица измерения — от неё зависит только показ, не расчёт. */
export type KpiUnit = 'money' | 'count' | 'minutes';

/** Факт за период: сколько всего и сколько у каждого ответственного. */
type KpiFact = {
  /** Итог по компании. Для `money` — рубли с копейками строкой. */
  total: string;
  /** `userId` → значение. Пусто у метрик без ответственного. */
  byManager: Map<string, string>;
};

export type KpiMetric = {
  key: KpiMetricKey;
  /** Название, которое видит человек. Из него же берётся подпись плана. */
  label: string;
  unit: KpiUnit;
  /** Есть ли у объекта ответственный (`Р-Э7-3`). */
  perManager: boolean;
  /**
   * Куда ведёт плитка «Мои KPI» в кабинете менеджера (`У-245`).
   *
   * Живёт в реестре, а не в компоненте: плитка без ссылки — тупик («вижу
   * число и не понимаю, из чего оно»), а забывчивость ловится стражем
   * полноты реестра, а не ревью.
   */
  managerHref: string;
  /** Одна строка: что именно считается. Показывается в хабе KPI. */
  hint: string;
  compute: (
    prisma: PrismaClient,
    args: { companyId: string; from: Date; to: Date }
  ) => Promise<KpiFact>;
};

/** Больше восьми плиток на дашборде — это уже не дашборд, а таблица. */
export const MAX_ACTIVE_METRICS = 8;

/** Пока компания ничего не выбрала, считается один показатель — как до этапа. */
const DEFAULT_ACTIVE_METRICS: KpiMetricKey[] = ['revenue_paid'];

/**
 * Активные показатели компании. Пустой список = прежнее поведение: один
 * «Оплачено». Незнакомый ключ (показатель убрали из реестра, а в базе он
 * остался) молча пропускается — экран не должен падать из-за строки в базе.
 */
export function resolveActiveMetrics(stored: string[]): KpiMetricKey[] {
  const keys = stored.filter(isKpiMetricKey);
  return keys.length > 0 ? keys : [...DEFAULT_ACTIVE_METRICS];
}

const ZERO = new Prisma.Decimal(0);

function moneyFact(total: Prisma.Decimal, byManager: Map<string, Prisma.Decimal>): KpiFact {
  return {
    total: total.toFixed(2),
    byManager: new Map([...byManager].map(([id, v]) => [id, v.toFixed(2)])),
  };
}

function countFact(rows: Array<{ managerId: string | null; count: number }>): KpiFact {
  let total = 0;
  const byManager = new Map<string, string>();
  for (const r of rows) {
    total += r.count;
    if (r.managerId)
      byManager.set(r.managerId, String((Number(byManager.get(r.managerId)) || 0) + r.count));
  }
  return { total: String(total), byManager };
}

/**
 * Первый ответ: от первого входящего сообщения диалога до первого исходящего
 * после него. Диалог попадает в период по времени ПЕРВОГО ВХОДЯЩЕГО.
 *
 * Считается одним запросом с оконной функцией: выборка в цикле по диалогам
 * убила бы отчёт на живой базе (`У-248`). Диалог без ответа в среднее не
 * входит — иначе среднее занижается тем, что ещё не случилось (§5.3 спеки).
 */
async function firstResponseRows(
  prisma: PrismaClient,
  args: { companyId: string; from: Date; to: Date }
): Promise<Array<{ assigneeId: string | null; minutes: number }>> {
  return prisma.$queryRaw<Array<{ assigneeId: string | null; minutes: number }>>`
    WITH first_in AS (
      SELECT DISTINCT ON (m."dialogId")
             m."dialogId", m."createdAt" AS in_at
        FROM "MessengerMessage" m
        JOIN "MessengerDialog" d ON d.id = m."dialogId"
       WHERE d."companyId" = ${args.companyId}
         AND m.direction = 'in'
       ORDER BY m."dialogId", m."createdAt"
    ),
    first_out AS (
      SELECT fi."dialogId", fi.in_at,
             (SELECT MIN(o."createdAt")
                FROM "MessengerMessage" o
               WHERE o."dialogId" = fi."dialogId"
                 AND o.direction = 'out'
                 AND o."createdAt" >= fi.in_at) AS out_at
        FROM first_in fi
       WHERE fi.in_at >= ${args.from} AND fi.in_at < ${args.to}
    )
    SELECT d."assigneeId" AS "assigneeId",
           EXTRACT(EPOCH FROM (fo.out_at - fo.in_at)) / 60 AS minutes
      FROM first_out fo
      JOIN "MessengerDialog" d ON d.id = fo."dialogId"
     WHERE fo.out_at IS NOT NULL
  `;
}

export const KPI_METRICS: KpiMetric[] = [
  {
    key: 'revenue_paid',
    managerHref: '/manager/finance',
    label: 'Оплачено',
    unit: 'money',
    perManager: true,
    hint: 'Деньги, поступившие за период по заказам компании; возвраты вычитаются.',
    async compute(prisma, { companyId, from, to }) {
      // Колонки `companyId` у платежа нет — компания достаётся через заказ.
      const rows = await prisma.payment.findMany({
        where: { paidAt: { gte: from, lt: to }, order: { companyId } },
        select: { amount: true, isRefund: true, order: { select: { managerId: true } } },
      });
      let total = ZERO;
      const byManager = new Map<string, Prisma.Decimal>();
      for (const r of rows) {
        const value = r.isRefund ? r.amount.negated() : r.amount;
        total = total.plus(value);
        const managerId = r.order?.managerId;
        if (managerId) byManager.set(managerId, (byManager.get(managerId) ?? ZERO).plus(value));
      }
      return moneyFact(total, byManager);
    },
  },
  {
    key: 'orders_created',
    managerHref: '/manager/orders',
    label: 'Заказы заведены',
    unit: 'count',
    perManager: true,
    hint: 'Сколько заказов компании завели за период.',
    async compute(prisma, { companyId, from, to }) {
      const rows = await prisma.order.groupBy({
        by: ['managerId'],
        where: { companyId, createdAt: { gte: from, lt: to } },
        _count: { _all: true },
      });
      return countFact(rows.map((r) => ({ managerId: r.managerId, count: r._count._all })));
    },
  },
  {
    key: 'leads_created',
    managerHref: '/manager/leads',
    label: 'Лиды заведены',
    unit: 'count',
    perManager: true,
    hint: 'Новые лиды компании за период: свои — это лиды с ответственным компании или её организации.',
    async compute(prisma, { companyId, from, to }) {
      const rows = await prisma.lead.groupBy({
        by: ['assignedManagerId'],
        where: { ...leadCompanyWhere(companyId), createdAt: { gte: from, lt: to } },
        _count: { _all: true },
      });
      return countFact(rows.map((r) => ({ managerId: r.assignedManagerId, count: r._count._all })));
    },
  },
  {
    key: 'proposals_sent',
    managerHref: '/manager/documents?type=commercial_proposal',
    label: 'КП отправлено',
    unit: 'count',
    perManager: true,
    hint: 'Коммерческие предложения, отправленные клиенту за период; перевыпуск не считается дважды.',
    async compute(prisma, { companyId, from, to }) {
      const rows = await prisma.document.groupBy({
        by: ['sentById'],
        where: {
          companyId,
          type: 'commercial_proposal',
          supersededAt: null,
          sentAt: { gte: from, lt: to },
        },
        _count: { _all: true },
      });
      return countFact(rows.map((r) => ({ managerId: r.sentById, count: r._count._all })));
    },
  },
  {
    key: 'deals_won',
    managerHref: '/manager/deals',
    label: 'Сделки выиграны',
    unit: 'count',
    perManager: true,
    hint: 'Сделки, отмеченные выигранными за период.',
    async compute(prisma, { companyId, from, to }) {
      const rows = await prisma.deal.groupBy({
        by: ['managerId'],
        where: { companyId, status: 'won', wonAt: { gte: from, lt: to } },
        _count: { _all: true },
      });
      return countFact(rows.map((r) => ({ managerId: r.managerId, count: r._count._all })));
    },
  },
  {
    key: 'calls_outbound',
    managerHref: '/manager/calls',
    label: 'Звонки исходящие',
    unit: 'count',
    perManager: true,
    hint: 'Исходящие звонки сотрудников за период.',
    async compute(prisma, { companyId, from, to }) {
      const rows = await prisma.call.groupBy({
        by: ['initiatedByUserId'],
        where: { companyId, direction: 'outbound', startedAt: { gte: from, lt: to } },
        _count: { _all: true },
      });
      return countFact(rows.map((r) => ({ managerId: r.initiatedByUserId, count: r._count._all })));
    },
  },
  {
    key: 'dialogs_answered',
    managerHref: '/manager/messengers',
    label: 'Диалоги с ответом',
    unit: 'count',
    perManager: true,
    hint: 'Переписки, на первое сообщение которых ответили; период считается по первому сообщению клиента.',
    async compute(prisma, args) {
      const rows = await firstResponseRows(prisma, args);
      return countFact(rows.map((r) => ({ managerId: r.assigneeId, count: 1 })));
    },
  },
  {
    key: 'avg_first_response_min',
    managerHref: '/manager/messengers',
    label: 'Среднее время первого ответа',
    unit: 'minutes',
    perManager: true,
    hint: 'Сколько в среднем ждут первого ответа. Переписки без ответа в среднее не входят.',
    async compute(prisma, args) {
      const rows = await firstResponseRows(prisma, args);
      const sums = new Map<string, { sum: number; n: number }>();
      let sum = 0;
      for (const r of rows) {
        sum += r.minutes;
        if (!r.assigneeId) continue;
        const acc = sums.get(r.assigneeId) ?? { sum: 0, n: 0 };
        acc.sum += r.minutes;
        acc.n += 1;
        sums.set(r.assigneeId, acc);
      }
      const byManager = new Map<string, string>();
      for (const [id, acc] of sums) byManager.set(id, (acc.sum / acc.n).toFixed(1));
      return { total: rows.length ? (sum / rows.length).toFixed(1) : '0.0', byManager };
    },
  },
  {
    key: 'tasks_overdue',
    managerHref: '/manager/tasks',
    label: 'Просроченные задачи',
    unit: 'count',
    perManager: true,
    hint: 'Задачи компании, у которых срок в прошлом, а работа не завершена. Считается на момент показа.',
    async compute(prisma, { companyId, to }) {
      // Просрочка — состояние, а не событие внутри периода: на конец прошедшего
      // периода и на момент показа — для текущего (прогон сопровождения №36).
      // Было `dueDate < to` всегда: у текущего месяца `to` — 1-е число
      // следующего, и задача со сроком «28.09», открытая 23.09, уже считалась
      // просроченной, хотя подсказка обещает счёт «на момент показа». Граница —
      // общее правило сроков (`lib/tasks/due.ts`, `Р-М-3`): срок просрочен,
      // когда закончился его московский день. Для прошедшего месяца
      // `pastDueWhere(to)` — ровно прежнее `dueDate < to`: `to` — московская
      // полночь.
      const asOf = new Date(Math.min(Date.now(), to.getTime()));
      const dueDate = pastDueWhere(asOf);
      const rows = await prisma.taskAssignee.groupBy({
        by: ['userId'],
        where: {
          task: { companyId, status: { not: 'done' }, dueDate },
        },
        _count: { _all: true },
      });
      const unassigned = await prisma.task.count({
        where: { companyId, status: { not: 'done' }, dueDate, assignees: { none: {} } },
      });
      const fact = countFact(rows.map((r) => ({ managerId: r.userId, count: r._count._all })));
      return { total: String(Number(fact.total) + unassigned), byManager: fact.byManager };
    },
  },
  {
    key: 'certificates_issued',
    // `У-263`: было `/manager/students` — адрес давно стал перенаправлением
    // (`У-103`: сквозной список сотрудников снят, людей смотрят в карточке
    // организации). Показатель вёл человека через лишний переход, а после
    // удаления шлюза привёл бы в никуда. Нашёл `npm run report:legacy-links`.
    managerHref: '/manager/organizations',
    label: 'Удостоверения выданы',
    unit: 'count',
    perManager: false,
    hint: 'Удостоверения, выданные организациям компании за период. Ответственного у удостоверения нет.',
    async compute(prisma, { companyId, from, to }) {
      const total = await prisma.certificate.count({
        where: { issuedAt: { gte: from, lt: to }, organization: { companyId } },
      });
      return { total: String(total), byManager: new Map() };
    },
  },
];

const BY_KEY = new Map<string, KpiMetric>(KPI_METRICS.map((m) => [m.key, m]));

export function isKpiMetricKey(value: string): value is KpiMetricKey {
  return BY_KEY.has(value);
}

export function kpiMetric(key: KpiMetricKey): KpiMetric {
  // Ключ приходит только из реестра или после `isKpiMetricKey` — промаха не бывает.
  return BY_KEY.get(key)!;
}
