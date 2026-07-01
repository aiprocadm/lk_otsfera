'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager, requireManagerLeader } from '@/lib/auth/requireRole';
import { claimOrder, assignOrderManager } from '@/lib/services/manager/distribution';

function revalidateOrder(orderId: string): void {
  revalidatePath(`/manager/orders/${orderId}`);
  revalidatePath('/manager/orders');
  revalidatePath(`/leader/orders/${orderId}`);
  revalidatePath('/leader/orders');
}

const ClaimSchema = z.object({ orderId: z.string().min(1) });

export type ClaimOrderActionResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'validation' | 'not_found' | 'forbidden' | 'already_assigned' };

/** §5.3 self-assign: менеджер забирает незакреплённую заявку в работу. */
export async function claimOrderAction(input: { orderId: string }): Promise<ClaimOrderActionResult> {
  const parsed = ClaimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();
  const result = await claimOrder(prisma, session, { orderId: parsed.data.orderId });
  if (!result.ok) return result;

  revalidateOrder(parsed.data.orderId);
  return { ok: true, changed: result.changed };
}

const AssignSchema = z.object({
  orderId: z.string().min(1),
  managerUserId: z.string().min(1).nullable()
});

export type AssignManagerLeaderActionResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'validation' | 'order_not_found' | 'invalid_manager' | 'forbidden' };

/**
 * §5.3 manual assignment by a leader. Same-company guard (C8): a leader may only
 * assign managers on orders of their own company. Admin uses the parallel
 * /admin action (assignOrderManagerAction) which shares the same service.
 */
export async function assignOrderManagerLeaderAction(input: {
  orderId: string;
  managerUserId: string | null;
}): Promise<AssignManagerLeaderActionResult> {
  const parsed = AssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    select: { companyId: true }
  });
  if (!order) return { ok: false, error: 'order_not_found' };
  if (!session.companyId || order.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }

  const result = await assignOrderManager(prisma, session, {
    orderId: parsed.data.orderId,
    managerUserId: parsed.data.managerUserId,
    // C8: candidate manager must belong to the leader's (= order's) company.
    restrictToCompanyId: session.companyId
  });
  if (!result.ok) return result;

  revalidateOrder(parsed.data.orderId);
  return { ok: true, changed: result.changed };
}
