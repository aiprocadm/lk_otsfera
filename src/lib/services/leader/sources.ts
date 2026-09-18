import type { PrismaClient } from '@prisma/client';
import { leadCompanyWhere } from '@/lib/auth/leadScope';

/**
 * Откуда приходят клиенты (`У-247`, этап 7).
 *
 * Два справочника источников в системе не пересекаются и не сводятся друг к
 * другу: у лида семь значений (канал или система, откуда он пришёл), у
 * обращения — три (кабинет происхождения). Поэтому отчёт показывает их рядом,
 * общим словарём русских названий, а не пытается слить в один список: слияние
 * дало бы правдоподобную, но выдуманную цифру.
 *
 * Конверсия — когортная: берём лиды, СОЗДАННЫЕ за период, и смотрим, во что
 * они превратились, когда бы это ни случилось. Иначе числитель и знаменатель
 * оказываются из разных множеств (та же ошибка, что чинили в конверсии КП).
 */
type SourceRow = {
  source: string;
  label: string;
  leads: number;
  /** Сколько из них дошли до сделки — средний шаг воронки (`У-247`). */
  deals: number;
  /** Сколько из них доросли до заказа. */
  orders: number;
  /** Процент лид → заказ; `null`, если лидов не было. */
  conversionPct: number | null;
};

type RequestSourceRow = { source: string; label: string; requests: number };

export type SourcesResult = {
  leads: SourceRow[];
  requests: RequestSourceRow[];
  totalLeads: number;
  totalDeals: number;
  totalOrders: number;
};

/** Русские названия источников лида. Ключи — значения перечисления в базе. */
const LEAD_SOURCE_LABELS: Record<string, string> = {
  partner_legacy: 'Партнёр (прежний обмен)',
  client_request: 'Обращение клиента',
  manual: 'Заведён вручную',
  website: 'Сайт',
  call: 'Звонок',
  inbound_message: 'Сообщение в мессенджер',
  bitrix: 'Перенос из Битрикс24',
};

/** Русские названия источников обращения — другой справочник, другой смысл. */
const REQUEST_SOURCE_LABELS: Record<string, string> = {
  partner_cabinet: 'Кабинет партнёра',
  organization_cabinet: 'Кабинет заказчика',
  website: 'Сайт',
};

export async function getSources(
  prisma: PrismaClient,
  args: { companyId: string; from: Date; to: Date }
): Promise<SourcesResult> {
  const scope = leadCompanyWhere(args.companyId);
  const period = { gte: args.from, lt: args.to };

  const [leadRows, dealRows, promotedRows, requestRows] = await Promise.all([
    prisma.lead.groupBy({
      by: ['source'],
      where: { ...scope, createdAt: period },
      _count: { _all: true },
    }),
    // Средний шаг воронки: те же лиды периода, у которых появилась сделка.
    // Без него видно только края («пришло» и «купили»), и непонятно, где
    // теряются люди — в разговоре или уже в оформлении.
    prisma.lead.groupBy({
      by: ['source'],
      where: { ...scope, createdAt: period, promotedDealId: { not: null } },
      _count: { _all: true },
    }),
    // Когорта: те же лиды периода, у которых появился заказ.
    prisma.lead.groupBy({
      by: ['source'],
      where: { ...scope, createdAt: period, promotedOrderId: { not: null } },
      _count: { _all: true },
    }),
    prisma.clientRequest.groupBy({
      by: ['source'],
      where: { organization: { companyId: args.companyId }, createdAt: period },
      _count: { _all: true },
    }),
  ]);

  const promoted = new Map(promotedRows.map((r) => [String(r.source), r._count._all]));
  const dealt = new Map(dealRows.map((r) => [String(r.source), r._count._all]));

  let totalLeads = 0;
  let totalDeals = 0;
  let totalOrders = 0;
  const leads: SourceRow[] = leadRows.map((r) => {
    const source = String(r.source);
    const count = r._count._all;
    const orders = promoted.get(source) ?? 0;
    const deals = dealt.get(source) ?? 0;
    totalLeads += count;
    totalDeals += deals;
    totalOrders += orders;
    return {
      source,
      // Незнакомое значение показываем как есть: справочник мог пополниться,
      // а отчёт не должен молча прятать строку.
      label: LEAD_SOURCE_LABELS[source] ?? source,
      leads: count,
      deals,
      orders,
      conversionPct: count > 0 ? Math.round((orders / count) * 100) : null,
    };
  });
  leads.sort((a, b) => b.leads - a.leads);

  const requests: RequestSourceRow[] = requestRows
    .map((r) => ({
      source: String(r.source),
      label: REQUEST_SOURCE_LABELS[String(r.source)] ?? String(r.source),
      requests: r._count._all,
    }))
    .sort((a, b) => b.requests - a.requests);

  return { leads, requests, totalLeads, totalDeals, totalOrders };
}
