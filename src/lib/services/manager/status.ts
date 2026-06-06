import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { notifyManagers, notifyOrgUsers } from '@/lib/notifications';

/**
 * Manager-facing execution status transition.
 *
 * Allowed transitions are constrained to {pending, in_progress, completed}.
 * The other ExecutionStatus values (`cancelled`, `on_hold`) follow different
 * workflows (admin / billing) and are intentionally not settable from the
 * manager cabinet — see plan §5 ("Write paths").
 *
 * Side effects:
 *   - Order.executionStatus is updated.
 *   - Order.completedAt is set when entering `completed` and cleared when
 *     leaving `completed`.
 *   - An `order_status_changed` audit row is recorded with before/after.
 *   - All active members of the order's organization receive an in-app
 *     notification (best-effort email) via notifyOrgUsers.
 *   - Other managers attached to this order/org (per-order, per-org, or
 *     historical) receive an in-app notification + best-effort email via
 *     notifyManagers (`order_status_changed_by_manager`), excluding the actor.
 */

// PRODUCT DECISION (2026-06-06): any transition between these statuses is
// intentionally allowed, INCLUDING reopening a completed order
// (completed → pending / in_progress). This is a flat allow-list by design,
// NOT a transition matrix — do NOT add a guard blocking reopen without product
// sign-off. Regression-locked in server-actions.manager.status.test.ts.
const MANAGER_SETTABLE_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type ManagerSettableStatus = (typeof MANAGER_SETTABLE_STATUSES)[number];

export class ManagerStatusError extends Error {
  constructor(public code: 'invalid_status' | 'forbidden' | 'not_found') {
    super(code);
    this.name = 'ManagerStatusError';
  }
}

export async function transitionOrderStatus(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string,
  newStatus: ManagerSettableStatus
): Promise<{ changed: boolean }> {
  if (!MANAGER_SETTABLE_STATUSES.includes(newStatus)) {
    throw new ManagerStatusError('invalid_status');
  }

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      companyId: true,
      executionStatus: true,
      orderNumber: true,
      title: true
    }
  });
  if (!order) throw new ManagerStatusError('not_found');

  // Defence-in-depth on the write path (mode-aware): company-wide ⇒ same-company,
  // otherwise the three-way scope.
  if (!canSeeOrder(session, order, teamMode)) {
    throw new ManagerStatusError('forbidden');
  }

  // No-op when the order is already in the target status — avoids spurious
  // audit rows and avoidable notification fan-out on idempotent retries.
  if (order.executionStatus === newStatus) {
    return { changed: false };
  }

  const previousStatus = order.executionStatus;

  await prisma.order.update({
    where: { id: orderId },
    data: {
      executionStatus: newStatus,
      ...(newStatus === 'completed' ? { completedAt: new Date() } : {}),
      ...(previousStatus === 'completed' && newStatus !== 'completed'
        ? { completedAt: null }
        : {})
    }
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_status_changed',
    entity: 'order',
    entityId: orderId,
    before: { executionStatus: previousStatus },
    after: { executionStatus: newStatus, actor: 'manager' }
  });

  if (order.organizationId) {
    await notifyOrgUsers(prisma, {
      organizationId: order.organizationId,
      type: 'order_status_changed',
      payload: {
        orderId,
        orderNumber: order.orderNumber,
        orderTitle: order.title,
        dimension: 'execution',
        oldStatus: previousStatus,
        newStatus
      }
    });
  }

  // Best-effort fan-out to other managers in scope of this order (per-order,
  // per-org, or historical). Failure here must NOT roll back the status
  // update — the audit row + in-app org notifications are the source of
  // truth, the manager-side email is a side channel. `notifyManagers`
  // returns an empty summary when no other manager is in scope (e.g. the
  // actor is the sole assignee), so an empty recipient set is not an error.
  try {
    const actor = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { name: true }
    });
    await notifyManagers(
      prisma,
      {
        orderId,
        type: 'order_status_changed_by_manager',
        payload: {
          actorName: actor?.name ?? 'Менеджер',
          oldStatus: previousStatus,
          newStatus
        }
      },
      { excludeUserId: session.sub }
    );
  } catch (err) {
    console.warn('[manager/status] notifyManagers (order_status_changed_by_manager) failed', {
      orderId,
      actorId: session.sub,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return { changed: true };
}
