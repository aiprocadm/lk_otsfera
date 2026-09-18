import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

/**
 * Дебиторка компании по организациям (`У-243`, этап 7).
 *
 * Новый разрез, которого в системе не было: формула «выставлено минус
 * оплачено» жила в шести местах, и ни в одном не было ни срока долга, ни
 * ответственного — до руководителя доходило одно число на всю компанию.
 *
 * Считается **группировкой в базе** (`У-248`), а не в памяти. Так было не
 * всегда: первая редакция обещала «одним запросом», а на деле тянула ВСЕ
 * неоплаченные заказы компании в JavaScript и складывала их циклом. На ста
 * тысячах заказов это полсотни тысяч строк с присоединёнными организацией и
 * ответственным — и замер `У-248` перестал укладываться в бюджет, как только
 * машина стала чуть медленнее. Здесь три ограниченных запроса: суммы по
 * организациям, названия организаций и ответственный у самого старого долга.
 *
 * «Дней с даты счёта» берётся по самому СТАРОМУ неоплаченному заказу
 * организации: человек хочет знать, сколько уже ждут, а не среднее по больнице.
 */
type ReceivableRow = {
  organizationId: string;
  organizationName: string;
  billed: string;
  paid: string;
  debt: string;
  /** Сколько дней самому старому неоплаченному заказу; `null` — дат нет. */
  oldestDays: number | null;
  managerName: string | null;
};

export type ReceivablesResult = {
  rows: ReceivableRow[];
  totalDebt: string;
  /** Порог фильтра «старше N дней», как его применили. */
  olderThanDays: number;
};

/** Заказы, по которым ещё ждут денег. Отменённые и возвращённые — не долг. */
const UNPAID_STATUSES = ['billed', 'partially_paid'] as const;

/**
 * Ответственный у самого старого неоплаченного заказа каждой организации — к
 * нему и идти. Одним запросом с `DISTINCT ON`: тот же приём, что у первого
 * ответа в реестре показателей; выборка по организации в цикле вернула бы
 * отчёт к сотне запросов, от которых этап и уходил.
 */
async function oldestDebtManagers(
  prisma: PrismaClient,
  companyId: string
): Promise<Map<string, string | null>> {
  const rows = await prisma.$queryRaw<
    Array<{ organizationId: string; name: string | null; email: string | null }>
  >`
    SELECT DISTINCT ON (o."organizationId")
           o."organizationId" AS "organizationId",
           u."name"  AS "name",
           u."email" AS "email"
      FROM "Order" o
      LEFT JOIN "User" u ON u.id = o."managerId"
     WHERE o."companyId" = ${companyId}
       AND o."financialStatus"::text IN ('billed', 'partially_paid')
     ORDER BY o."organizationId", o."createdAt" ASC, o."id" ASC
  `;
  return new Map(rows.map((r) => [r.organizationId, r.name || r.email || null]));
}

export async function getReceivables(
  prisma: PrismaClient,
  args: { companyId: string; olderThanDays?: number }
): Promise<ReceivablesResult> {
  const olderThanDays = Math.max(0, Math.trunc(args.olderThanDays ?? 0));

  const grouped = await prisma.order.groupBy({
    by: ['organizationId'],
    where: { companyId: args.companyId, financialStatus: { in: [...UNPAID_STATUSES] } },
    _sum: { totalAmount: true, paidAmount: true },
    _min: { createdAt: true },
  });
  if (grouped.length === 0) return { rows: [], totalDebt: '0.00', olderThanDays };

  const orgIds = grouped.map((g) => g.organizationId);
  const [orgs, managers] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    }),
    oldestDebtManagers(prisma, args.companyId),
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));

  const now = Date.now();
  const rows: ReceivableRow[] = [];
  let totalDebt = new Prisma.Decimal(0);

  for (const g of grouped) {
    const billed = g._sum.totalAmount ?? new Prisma.Decimal(0);
    const paid = g._sum.paidAmount ?? new Prisma.Decimal(0);
    const debt = billed.minus(paid);
    // Переплата — не отрицательный долг: показывать «минус» в дебиторке значит
    // предлагать человеку вычесть её из чужого долга.
    if (debt.lte(0)) continue;

    const oldest = g._min.createdAt;
    const oldestDays = oldest ? Math.floor((now - oldest.getTime()) / (24 * 60 * 60 * 1000)) : null;
    if (olderThanDays > 0 && (oldestDays === null || oldestDays < olderThanDays)) continue;

    rows.push({
      organizationId: g.organizationId,
      // Организация могла пропасть между двумя запросами — прочерк вместо
      // падения отчёта: строка с долгом важнее красивого названия.
      organizationName: orgName.get(g.organizationId) ?? '—',
      billed: billed.toFixed(2),
      paid: paid.toFixed(2),
      debt: debt.toFixed(2),
      oldestDays,
      managerName: managers.get(g.organizationId) ?? null,
    });
    totalDebt = totalDebt.plus(debt);
  }

  // Сверху — самые большие долги: с них начинают разбор.
  rows.sort((a, b) => Number(b.debt) - Number(a.debt));
  return { rows, totalDebt: totalDebt.toFixed(2), olderThanDays };
}
