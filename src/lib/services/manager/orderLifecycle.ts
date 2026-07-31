import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Отметка «Бухгалтерия подписана».
 *
 * §10 ТЗ v0.5 (этап 2, PR-4): переходы статуса отсюда удалены — рабочий статус
 * живёт в справочнике (`services/orderStatuses/`), вместе с ним уехали матрица
 * переходов и проверка условий закрытия. Осталось само событие подписи: по
 * нему статус ставится автоматически (якорь `accounting_signed`).
 */

export type AccountingSignedResult =
  { ok: true; changed: boolean } | { ok: false; error: 'not_found' | 'forbidden' };

/**
 * §21 ТЗ: менеджер отмечает «бухгалтерия подписана» галочкой. Идемпотентно;
 * питает условие завершения `accounting_signed` (см. orders/completion.ts).
 */
export async function setOrderAccountingSigned(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; signed: boolean }
): Promise<AccountingSignedResult> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      companyId: true,
      accountingSignedAt: true,
    },
  });
  if (!order) return { ok: false, error: 'not_found' };
  if (!canSeeOrder(session, order, teamMode)) return { ok: false, error: 'forbidden' };

  const currentlySigned = order.accountingSignedAt !== null;
  if (currentlySigned === args.signed) return { ok: true, changed: false };

  await prisma.order.update({
    where: { id: args.orderId },
    data: { accountingSignedAt: args.signed ? new Date() : null },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_accounting_signed',
    entity: 'order',
    entityId: args.orderId,
    after: { signed: args.signed },
  });

  return { ok: true, changed: true };
}
