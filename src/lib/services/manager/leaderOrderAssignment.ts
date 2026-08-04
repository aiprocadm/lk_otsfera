import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { assignOrderManager, type AssignManagerResult } from '@/lib/services/manager/distribution';

export type AssignOrderManagerAsLeaderResult =
  AssignManagerResult | { ok: false; error: 'forbidden' };

/**
 * §5.3 ручное назначение менеджера руководителем. Same-company guard (C8):
 * руководитель назначает менеджеров только на заявки своей компании — заявка
 * чужой компании отсекается ДО обращения к общему `assignOrderManager`.
 * Кандидат сужается тем же `restrictToCompanyId`, иначе менеджер чужой компании
 * получил бы доступ к заявке. Admin (Model A) ходит параллельным
 * /admin-экшеном, который зовёт общий сервис без обоих сужений.
 */
export async function assignOrderManagerAsLeader(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; managerUserId: string | null }
): Promise<AssignOrderManagerAsLeaderResult> {
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { companyId: true },
  });
  if (!order) return { ok: false, error: 'order_not_found' };
  if (!session.companyId || order.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }

  return assignOrderManager(prisma, session, {
    orderId: args.orderId,
    managerUserId: args.managerUserId,
    // C8: candidate manager must belong to the leader's (= order's) company.
    restrictToCompanyId: session.companyId,
  });
}
