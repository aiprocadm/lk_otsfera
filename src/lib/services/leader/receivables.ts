import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

/**
 * Дебиторка компании по организациям (`У-243`, этап 7).
 *
 * Новый разрез, которого в системе не было: формула «выставлено минус
 * оплачено» жила в шести местах, и ни в одном не было ни срока долга, ни
 * ответственного — до руководителя доходило одно число на всю компанию.
 *
 * Считается **одним запросом** с группировкой по организации (`У-248`): по
 * организации в цикле это был бы отчёт на сотню запросов.
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

export async function getReceivables(
  prisma: PrismaClient,
  args: { companyId: string; olderThanDays?: number }
): Promise<ReceivablesResult> {
  const olderThanDays = Math.max(0, Math.trunc(args.olderThanDays ?? 0));

  const orders = await prisma.order.findMany({
    where: { companyId: args.companyId, financialStatus: { in: [...UNPAID_STATUSES] } },
    select: {
      organizationId: true,
      totalAmount: true,
      paidAmount: true,
      createdAt: true,
      organization: { select: { name: true } },
      manager: { select: { name: true, email: true } },
    },
  });

  const now = Date.now();
  type Acc = {
    name: string;
    billed: Prisma.Decimal;
    paid: Prisma.Decimal;
    oldest: Date | null;
    manager: string | null;
  };
  const byOrg = new Map<string, Acc>();

  for (const o of orders) {
    const acc: Acc = byOrg.get(o.organizationId) ?? {
      name: o.organization.name,
      billed: new Prisma.Decimal(0),
      paid: new Prisma.Decimal(0),
      oldest: null,
      manager: null,
    };
    acc.billed = acc.billed.plus(o.totalAmount);
    acc.paid = acc.paid.plus(o.paidAmount);
    if (!acc.oldest || o.createdAt < acc.oldest) acc.oldest = o.createdAt;
    // Ответственный берётся у самого старого долга: это тот, к кому идти.
    if (acc.manager === null && o.manager) acc.manager = o.manager.name || o.manager.email;
    byOrg.set(o.organizationId, acc);
  }

  const rows: ReceivableRow[] = [];
  let totalDebt = new Prisma.Decimal(0);
  for (const [organizationId, acc] of byOrg) {
    const debt = acc.billed.minus(acc.paid);
    // Переплата — не отрицательный долг: показывать «минус» в дебиторке значит
    // предлагать человеку вычесть её из чужого долга.
    if (debt.lte(0)) continue;
    const oldestDays = acc.oldest
      ? Math.floor((now - acc.oldest.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    if (olderThanDays > 0 && (oldestDays === null || oldestDays < olderThanDays)) continue;
    rows.push({
      organizationId,
      organizationName: acc.name,
      billed: acc.billed.toFixed(2),
      paid: acc.paid.toFixed(2),
      debt: debt.toFixed(2),
      oldestDays,
      managerName: acc.manager,
    });
    totalDebt = totalDebt.plus(debt);
  }

  // Сверху — самые большие долги: с них начинают разбор.
  rows.sort((a, b) => Number(b.debt) - Number(a.debt));
  return { rows, totalDebt: totalDebt.toFixed(2), olderThanDays };
}
