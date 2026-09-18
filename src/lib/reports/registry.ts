import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader } from '@/lib/auth/roleModel';
import { can } from '@/lib/auth/accessProfile';
import { moscowMonthRange } from '@/lib/dates/calendar';
import { getKpiPlanFact } from '@/lib/kpi/plan';
import { getReceivables } from '@/lib/services/leader/receivables';
import { getCommunications } from '@/lib/services/leader/communications';
import { getSources } from '@/lib/services/leader/sources';
import { getPartnersAnalytics } from '@/lib/services/leader/partnersAnalytics';
import { getManagerLoad } from '@/lib/services/leader/managerLoad';

/**
 * Реестр отчётов (`У-244`, этап 7).
 *
 * Одна запись на отчёт: ключ, русское название, кому доступен, какие колонки и
 * как собираются строки. Маршрут выгрузки ничего про отчёты не знает — он берёт
 * запись из реестра, поэтому новый отчёт добавляется одной записью, а не
 * четырьмя правками в разных местах.
 *
 * Скоуп живёт ВНУТРИ выборки (§4): отчёт получает компанию и сессию и сам
 * решает, что показать. Проверка прав стоит отдельно — до выборки, чтобы
 * запрещённый отчёт не успел прочитать ни строки.
 */
export type ReportKey =
  | 'plan_fact'
  | 'funnel_by_source'
  | 'receivables'
  | 'communications'
  | 'partner_accruals'
  | 'manager_load';

/** Кто вправе выгружать. Менеджеру отчёты руководителя недоступны (`У-249`). */
type ReportAudience = 'staffLeader' | 'partner';

type ReportColumn = { key: string; header: string; width?: number };

type ReportRow = Record<string, string | number>;

export type ReportContext = {
  prisma: PrismaClient;
  session: SessionPayload;
  /** Компания отчёта: у руководителя из сессии, у администратора из адреса. */
  companyId: string;
  year: number;
  month: number;
  /** Фильтр «старше N дней» — только у дебиторки. */
  olderThanDays: number;
};

export type ReportDefinition = {
  key: ReportKey;
  title: string;
  /** Одна строка: что внутри. Показывается на вкладке «Экспорт». */
  hint: string;
  audiences: ReportAudience[];
  columns: ReportColumn[];
  /** Сколько строк получится — считается ДО выборки (`Р-Э7-5`). */
  count: (ctx: ReportContext) => Promise<number>;
  rows: (ctx: ReportContext) => Promise<ReportRow[]>;
};

/**
 * Предел строк отчёта — **отказ, а не усечение** (`Р-Э7-5`). У прежних выгрузок
 * своё правило (`EXPORT_ROW_LIMIT = 10 000`, «показаны первые N из M»): там
 * человек смотрит на список, здесь — считает по нему деньги, и молча срезанный
 * отчёт хуже отказа.
 */
export const REPORT_ROW_LIMIT = 50_000;

function period(ctx: ReportContext): { from: Date; to: Date } {
  return moscowMonthRange(ctx.year, ctx.month);
}

function money(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const REPORTS: ReportDefinition[] = [
  {
    key: 'plan_fact',
    title: 'План и факт',
    hint: 'Выполнение планов по каждому показателю и каждому менеджеру за месяц.',
    audiences: ['staffLeader'],
    columns: [
      { key: 'metric', header: 'Показатель', width: 28 },
      { key: 'who', header: 'Кто', width: 28 },
      { key: 'plan', header: 'План', width: 14 },
      { key: 'fact', header: 'Факт', width: 14 },
      { key: 'percent', header: 'Выполнение, %', width: 16 },
      { key: 'prev', header: 'Было в прошлом месяце', width: 22 },
    ],
    async count(ctx) {
      const data = await getKpiPlanFact(ctx.prisma, {
        companyId: ctx.companyId,
        year: ctx.year,
        month: ctx.month,
      });
      return data.rows.length;
    },
    async rows(ctx) {
      const data = await getKpiPlanFact(ctx.prisma, {
        companyId: ctx.companyId,
        year: ctx.year,
        month: ctx.month,
      });
      return data.rows.map((r) => ({
        metric: r.metricLabel,
        who: r.managerName,
        // «План не задан» — это не ноль: ноль означал бы «ничего не ждём».
        plan: r.plan === null ? 'план не задан' : money(r.plan),
        fact: money(r.fact),
        percent: r.percent === null ? '—' : r.percent,
        prev: money(r.prevFact),
      }));
    },
  },
  {
    key: 'funnel_by_source',
    title: 'Воронка по источникам',
    hint: 'Сколько лидов пришло из каждого источника и сколько из них стали заказом.',
    audiences: ['staffLeader'],
    columns: [
      { key: 'source', header: 'Источник', width: 30 },
      { key: 'leads', header: 'Лидов', width: 12 },
      { key: 'deals', header: 'Стали сделкой', width: 16 },
      { key: 'orders', header: 'Стали заказом', width: 16 },
      { key: 'conversion', header: 'Конверсия, %', width: 16 },
    ],
    async count(ctx) {
      const data = await getSources(ctx.prisma, { companyId: ctx.companyId, ...period(ctx) });
      return data.leads.length;
    },
    async rows(ctx) {
      const data = await getSources(ctx.prisma, { companyId: ctx.companyId, ...period(ctx) });
      return data.leads.map((r) => ({
        source: r.label,
        leads: r.leads,
        deals: r.deals,
        orders: r.orders,
        conversion: r.conversionPct === null ? '—' : r.conversionPct,
      }));
    },
  },
  {
    key: 'receivables',
    title: 'Дебиторка',
    hint: 'Кто и сколько должен, как давно ждут и к кому идти.',
    audiences: ['staffLeader'],
    columns: [
      { key: 'organization', header: 'Организация', width: 34 },
      { key: 'billed', header: 'Выставлено', width: 16 },
      { key: 'paid', header: 'Оплачено', width: 16 },
      { key: 'debt', header: 'Долг', width: 16 },
      { key: 'days', header: 'Дней ждут', width: 14 },
      { key: 'manager', header: 'Ответственный', width: 24 },
    ],
    async count(ctx) {
      const data = await getReceivables(ctx.prisma, {
        companyId: ctx.companyId,
        olderThanDays: ctx.olderThanDays,
      });
      return data.rows.length;
    },
    async rows(ctx) {
      const data = await getReceivables(ctx.prisma, {
        companyId: ctx.companyId,
        olderThanDays: ctx.olderThanDays,
      });
      return data.rows.map((r) => ({
        organization: r.organizationName,
        billed: money(r.billed),
        paid: money(r.paid),
        debt: money(r.debt),
        days: r.oldestDays ?? '—',
        manager: r.managerName ?? '—',
      }));
    },
  },
  {
    key: 'communications',
    title: 'Коммуникации',
    hint: 'Скорость первого ответа по каналам, просрочки и переписки без ответа.',
    audiences: ['staffLeader'],
    // На экране два разреза — по каналам и по сотрудникам. В файле они идут
    // одной таблицей с колонкой «Разрез»: два листа человек сравнивал бы
    // вручную, а выкинуть разрез по сотрудникам значит потерять ответ на
    // главный вопрос руководителя — кто отвечает медленно.
    columns: [
      { key: 'scope', header: 'Разрез', width: 30 },
      { key: 'dialogs', header: 'Переписок', width: 14 },
      { key: 'answered', header: 'Ответили', width: 14 },
      { key: 'avg', header: 'Первый ответ, мин', width: 20 },
      { key: 'overSla', header: 'Просрочек', width: 14 },
      { key: 'noAnswer', header: 'Без ответа', width: 14 },
    ],
    async count(ctx) {
      const data = await getCommunications(ctx.prisma, {
        companyId: ctx.companyId,
        ...period(ctx),
      });
      return data.byChannel.length + data.byManager.length;
    },
    async rows(ctx) {
      const data = await getCommunications(ctx.prisma, {
        companyId: ctx.companyId,
        ...period(ctx),
      });
      return [
        ...data.byChannel.map((r) => ({
          scope: `Канал: ${r.channelLabel}`,
          dialogs: r.dialogs,
          answered: r.answered,
          avg: r.avgFirstResponseMin ?? '—',
          overSla: r.overSla,
          noAnswer: r.waitingNoAnswer,
        })),
        ...data.byManager.map((r) => ({
          scope: `Сотрудник: ${r.managerName}`,
          dialogs: r.dialogs,
          // Этих двух чисел в разрезе по сотрудникам нет: прочерк честнее нуля,
          // который прочитали бы как «никому не ответил».
          answered: '—',
          avg: r.avgFirstResponseMin ?? '—',
          overSla: r.overSla,
          noAnswer: '—',
        })),
      ];
    },
  },
  {
    key: 'partner_accruals',
    title: 'Начисления партнёрам',
    hint: 'Сколько начислено и выплачено каждому партнёру за месяц.',
    // Партнёр видит этот отчёт по себе — через свой кабинет (`У-249`).
    audiences: ['staffLeader', 'partner'],
    columns: [
      { key: 'partner', header: 'Партнёр', width: 30 },
      { key: 'organizations', header: 'Организаций', width: 14 },
      { key: 'accrued', header: 'Начислено', width: 16 },
      { key: 'paid', header: 'Выплачено', width: 16 },
      { key: 'requests', header: 'Обращений', width: 14 },
    ],
    async count(ctx) {
      const data = await getPartnersAnalytics(ctx.prisma, {
        companyId: ctx.companyId,
        ...period(ctx),
      });
      return scopePartnerRows(data.rows, ctx.session).length;
    },
    async rows(ctx) {
      const data = await getPartnersAnalytics(ctx.prisma, {
        companyId: ctx.companyId,
        ...period(ctx),
      });
      // Суммы комиссии — отдельное право (`see_commission`, §1.8 спеки).
      const showMoney = ctx.session.role !== 'manager' || can(ctx.session, 'see_commission');
      return scopePartnerRows(data.rows, ctx.session).map((r) => ({
        partner: r.partnerName,
        organizations: r.organizations,
        accrued: showMoney ? money(r.accrued) : 'нет доступа',
        paid: showMoney ? money(r.paid) : 'нет доступа',
        requests: r.requests,
      }));
    },
  },
  {
    key: 'manager_load',
    title: 'Загрузка менеджеров',
    hint: 'Сколько у каждого менеджера активных заказов, задач и переписок.',
    audiences: ['staffLeader'],
    columns: [
      { key: 'manager', header: 'Менеджер', width: 28 },
      { key: 'orders', header: 'Активных заказов', width: 18 },
      { key: 'tasks', header: 'Задач в работе', width: 18 },
      { key: 'overdue', header: 'Просрочено задач', width: 18 },
      { key: 'dialogs', header: 'Открытых переписок', width: 20 },
    ],
    async count(ctx) {
      const rows = await getManagerLoad(ctx.prisma, { companyId: ctx.companyId });
      return rows.length;
    },
    async rows(ctx) {
      const rows = await getManagerLoad(ctx.prisma, { companyId: ctx.companyId });
      return rows.map((r) => ({
        manager: r.managerName,
        orders: r.orders,
        tasks: r.tasks,
        overdue: r.overdueTasks,
        dialogs: r.dialogs,
      }));
    },
  },
];

/**
 * Партнёр видит в отчёте только себя. Проверка живёт здесь, а не в маршруте:
 * реестр — то место, где известно, что строка относится к партнёру.
 */
function scopePartnerRows<T extends { partnerId: string }>(
  rows: T[],
  session: SessionPayload
): T[] {
  if (session.role !== 'partner') return rows;
  const own = session.partnerId;
  return own ? rows.filter((r) => r.partnerId === own) : [];
}

const BY_KEY = new Map<string, ReportDefinition>(REPORTS.map((r) => [r.key, r]));

export function isReportKey(value: string): value is ReportKey {
  return BY_KEY.has(value);
}

export function reportByKey(key: ReportKey): ReportDefinition {
  // Ключ приходит только после `isReportKey` — промаха не бывает.
  return BY_KEY.get(key)!;
}

/**
 * Право на отчёт (`У-249`). Проверяется ДО выборки: запрещённый отчёт не должен
 * успеть прочитать ни строки.
 *
 * Рядовой менеджер отчётов руководителя не выгружает — это «нет», а не «пусто»:
 * пустой файл человек принял бы за «данных нет».
 */
export function canRunReport(report: ReportDefinition, session: SessionPayload): boolean {
  if (session.role === 'partner') return report.audiences.includes('partner');
  const isLeaderSide = session.role === 'admin' || isManagerLeader(session);
  return isLeaderSide && report.audiences.includes('staffLeader');
}
