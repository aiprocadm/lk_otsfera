import type { PrismaClient } from '@prisma/client';
import { moscowMonthRange } from '@/lib/dates/calendar';
import { countFailedDocumentPushes } from '@/lib/services/oneCSync/pushFailures';

/**
 * Свод по компаниям за месяц для администратора (`У-246`, этап 7).
 *
 * Администратор один на всю платформу, и вопрос у него кросс-компанийный:
 * «где что происходит». До этого этапа «Главная» показывала числа по
 * платформе целиком — по ним нельзя было понять, у какой компании встало.
 *
 * Считается без обхода по компаниям: пять группировок и два справочника
 * (организации и сотрудники) на всю платформу. Цикл «для каждой компании
 * спросим базу» на двадцати компаниях — это двадцать походов в базу на
 * каждый показ главной.
 *
 * У лида и обращения своей колонки `companyId` нет: лид принадлежит компании
 * через ответственного ИЛИ организацию (то же правило, что в `leadCompanyWhere`),
 * обращение — только через организацию. Поэтому связи разворачиваются здесь,
 * по двум справочникам, а не выборкой на каждую строку.
 */
type CompanyMonthRow = {
  companyId: string;
  companyName: string;
  orders: number;
  /** Поступило за месяц, возвраты вычтены; строка с двумя знаками. */
  paid: string;
  leads: number;
  requests: number;
};

export type CrossCompanyResult = {
  year: number;
  month: number;
  rows: CompanyMonthRow[];
  /** `У-174`: документы, которые 1С не приняла и которые ждут человека. */
  docsNotPushed: number;
  /** `У-198`: последний пакет миграции из Битрикс24 — или `null`, если их не было. */
  lastMigration: {
    companyName: string;
    status: string;
    mode: string;
    createdAt: Date;
  } | null;
};

/** Ключ компании у строки, где связь необязательна. */
function bump(map: Map<string, number>, key: string | null | undefined, by = 1): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + by);
}

export async function getCrossCompanyMonth(
  prisma: PrismaClient,
  args: { year: number; month: number }
): Promise<CrossCompanyResult> {
  const { year, month } = args;
  const { from, to } = moscowMonthRange(year, month);
  const period = { gte: from, lt: to };

  const [companies, orgs, staff, orderRows, payments, leadRows, requestRows, docsNotPushed, batch] =
    await Promise.all([
      prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.organization.findMany({ select: { id: true, companyId: true } }),
      prisma.user.findMany({
        where: { role: { in: ['manager', 'leader'] } },
        select: { id: true, companyId: true },
      }),
      prisma.order.groupBy({
        by: ['companyId'],
        where: { createdAt: period },
        _count: { _all: true },
      }),
      prisma.payment.findMany({
        where: { paidAt: period },
        select: { amount: true, isRefund: true, order: { select: { companyId: true } } },
      }),
      prisma.lead.groupBy({
        by: ['assignedManagerId', 'organizationId'],
        where: { createdAt: period },
        _count: { _all: true },
      }),
      prisma.clientRequest.groupBy({
        by: ['organizationId'],
        where: { createdAt: period },
        _count: { _all: true },
      }),
      // Тот же счётчик, что у светофора интеграций (`У-174`) — второй расчёт
      // тем же смыслом разъехался бы с первым на первой же правке.
      countFailedDocumentPushes(prisma),
      prisma.bitrixImportBatch.findMany({
        select: { companyId: true, status: true, mode: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
    ]);

  const orgCompany = new Map(orgs.map((o) => [o.id, o.companyId]));
  const staffCompany = new Map(staff.map((u) => [u.id, u.companyId]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  const ordersBy = new Map<string, number>();
  for (const r of orderRows) bump(ordersBy, r.companyId, r._count._all);

  const paidBy = new Map<string, number>();
  for (const p of payments) {
    const value = Number(p.amount) * (p.isRefund ? -1 : 1);
    bump(paidBy, p.order?.companyId, value);
  }

  const leadsBy = new Map<string, number>();
  for (const r of leadRows) {
    // Ответственный важнее организации: лид ведёт конкретная компания, даже
    // если организация клиента заведена у другой.
    const key =
      (r.assignedManagerId ? staffCompany.get(r.assignedManagerId) : null) ??
      (r.organizationId ? orgCompany.get(r.organizationId) : null);
    bump(leadsBy, key, r._count._all);
  }

  const requestsBy = new Map<string, number>();
  for (const r of requestRows)
    bump(requestsBy, r.organizationId ? orgCompany.get(r.organizationId) : null, r._count._all);

  const rows: CompanyMonthRow[] = companies.map((c) => ({
    companyId: c.id,
    companyName: c.name,
    orders: ordersBy.get(c.id) ?? 0,
    paid: (paidBy.get(c.id) ?? 0).toFixed(2),
    leads: leadsBy.get(c.id) ?? 0,
    requests: requestsBy.get(c.id) ?? 0,
  }));

  const last = batch[0];
  return {
    year,
    month,
    rows,
    docsNotPushed,
    lastMigration: last
      ? {
          // Компанию пакета показываем по справочнику; пропажа компании не
          // должна ронять главную — тогда просто «—».
          companyName: companyName.get(last.companyId) ?? '—',
          status: last.status,
          mode: last.mode,
          createdAt: last.createdAt,
        }
      : null,
  };
}
