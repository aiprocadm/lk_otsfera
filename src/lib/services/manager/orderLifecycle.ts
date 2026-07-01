import type { PrismaClient, OrderStatus, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { evaluateOrderCompletion, type CompletionCondition } from '@/lib/orders/completion';

/**
 * Approval / lifecycle state machine on the `Order.status` (`OrderStatus`) axis
 * (§5.2/§5.4/§5.6 ТЗ). This is a DIFFERENT axis from the operational
 * `executionStatus` (moved by manager/status.ts, a deliberately flat allow-list)
 * and from `financialStatus`. `Order.status` was previously dormant (always
 * `new`); we activate it here as the explicit-transition lifecycle:
 *
 *   new            → in_progress
 *   in_progress    → waiting_client | completed
 *   waiting_client → in_progress
 *   completed      → in_progress          (reopen — доделки, §5.6; audited)
 *
 * All transitions go through this service (explicit allow-list) — never a raw
 * `order.update({ status })` elsewhere. Money/commission logic is untouched.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['in_progress'],
  in_progress: ['waiting_client', 'completed'],
  waiting_client: ['in_progress'],
  completed: ['in_progress']
};

export type LifecycleErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'invalid_transition'
  | 'reason_required'
  | 'completion_conditions_unmet';

export type TransitionArgs = {
  orderId: string;
  to: OrderStatus;
  /** Обязательна при переходе в waiting_client (§5.4). */
  reason?: string;
};

export type TransitionResult =
  | { ok: true; changed: boolean; status: OrderStatus }
  | { ok: false; error: Exclude<LifecycleErrorCode, 'completion_conditions_unmet'> }
  | { ok: false; error: 'completion_conditions_unmet'; unmet: CompletionCondition[] };

export async function transitionOrderLifecycle(
  prisma: PrismaClient,
  session: SessionPayload,
  args: TransitionArgs
): Promise<TransitionResult> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      companyId: true,
      status: true,
      serviceType: true,
      accountingSignedAt: true,
      documents: { select: { scanStatus: true } },
      items: { select: { trainingStatus: true } }
    }
  });
  if (!order) return { ok: false, error: 'not_found' };
  if (!canSeeOrder(session, order, teamMode)) return { ok: false, error: 'forbidden' };

  const from = order.status;
  // Idempotent no-op: already in the target status — no audit, no fan-out.
  if (from === args.to) return { ok: true, changed: false, status: from };

  if (!ALLOWED_TRANSITIONS[from].includes(args.to)) {
    return { ok: false, error: 'invalid_transition' };
  }

  const reason = args.reason?.trim();
  if (args.to === 'waiting_client' && !reason) {
    return { ok: false, error: 'reason_required' };
  }

  if (args.to === 'completed') {
    const { ready, unmet } = evaluateOrderCompletion(order);
    if (!ready) return { ok: false, error: 'completion_conditions_unmet', unmet };
  }

  const data: Prisma.OrderUpdateInput = { status: args.to };
  if (args.to === 'waiting_client') {
    data.returnReason = reason;
  } else if (from === 'waiting_client') {
    // Возврат в работу — причина доработки больше не актуальна.
    data.returnReason = null;
  }

  await prisma.order.update({ where: { id: args.orderId }, data });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_lifecycle_changed',
    entity: 'order',
    entityId: args.orderId,
    before: { status: from },
    after: { status: args.to },
    ...(args.to === 'waiting_client' && reason ? { reason } : {})
  });

  return { ok: true, changed: true, status: args.to };
}

export type AccountingSignedResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'not_found' | 'forbidden' };

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
      accountingSignedAt: true
    }
  });
  if (!order) return { ok: false, error: 'not_found' };
  if (!canSeeOrder(session, order, teamMode)) return { ok: false, error: 'forbidden' };

  const currentlySigned = order.accountingSignedAt !== null;
  if (currentlySigned === args.signed) return { ok: true, changed: false };

  await prisma.order.update({
    where: { id: args.orderId },
    data: { accountingSignedAt: args.signed ? new Date() : null }
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_accounting_signed',
    entity: 'order',
    entityId: args.orderId,
    after: { signed: args.signed }
  });

  return { ok: true, changed: true };
}
