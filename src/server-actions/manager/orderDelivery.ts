'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { approveDeliverables, deliverOrderResult } from '@/lib/services/manager/orderDelivery';
import type { OrderReadiness } from '@/lib/orders/readiness';

/**
 * Этап 12 (Модуль 5, ФТ-5.1/5.2) — тонкий адаптер над сервисом передачи
 * результата (§2/§3 CLAUDE.md). Роль — `requireManager`; скоуп заказа держит
 * сам сервис (`canSeeOrder`, C8).
 */

const OrderIdSchema = z.object({ orderId: z.string().min(1) });

export type DeliverResultActionResult =
  | { ok: true; deliveredAt: string; alreadyDelivered: boolean }
  | { ok: false; error: 'validation' | 'not_found' | 'forbidden' }
  | { ok: false; error: 'not_ready'; readiness: OrderReadiness };

export type ApproveDeliverablesActionResult =
  | { ok: true; approvedAt: string }
  | { ok: false; error: 'validation' | 'not_found' | 'forbidden' };

function revalidateOrder(orderId: string): void {
  revalidatePath(`/manager/orders/${orderId}`);
  revalidatePath(`/leader/orders/${orderId}`);
  // Клиентские деталки показывают точку «Результат передан» (ФТ-5.4).
  revalidatePath(`/organization/orders/${orderId}`);
  revalidatePath(`/partner/deals/${orderId}`);
}

export async function deliverOrderResultAction(input: {
  orderId: string;
}): Promise<DeliverResultActionResult> {
  const parsed = OrderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();
  const res = await deliverOrderResult(prisma, session, parsed.data.orderId);
  if (!res.ok) {
    return res.error === 'not_ready'
      ? { ok: false, error: 'not_ready', readiness: res.readiness! }
      : { ok: false, error: res.error };
  }

  revalidateOrder(parsed.data.orderId);
  return {
    ok: true,
    deliveredAt: res.deliveredAt.toISOString(),
    alreadyDelivered: res.alreadyDelivered
  };
}

export async function approveDeliverablesAction(input: {
  orderId: string;
}): Promise<ApproveDeliverablesActionResult> {
  const parsed = OrderIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();
  const res = await approveDeliverables(prisma, session, parsed.data.orderId);
  if (!res.ok) return { ok: false, error: res.error };

  revalidateOrder(parsed.data.orderId);
  return { ok: true, approvedAt: res.approvedAt.toISOString() };
}
