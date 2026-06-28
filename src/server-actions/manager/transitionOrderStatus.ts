'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import {
  transitionOrderStatus,
  type ManagerSettableStatus
} from '@/lib/services/manager/status';

type ActionResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'validation' | 'invalid_status' | 'forbidden' | 'not_found'; details?: unknown };

const InputSchema = z.object({
  orderId: z.string().min(1),
  newStatus: z.enum(['pending', 'in_progress', 'completed'])
});

export async function transitionOrderStatusAction(input: {
  orderId: string;
  newStatus: string;
}): Promise<ActionResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation', details: parsed.error.flatten() };
  }

  const session = await requireManager();

  const result = await transitionOrderStatus(
    prisma,
    session,
    parsed.data.orderId,
    parsed.data.newStatus as ManagerSettableStatus
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/manager/orders/${parsed.data.orderId}`);
  revalidatePath('/manager/orders');
  revalidatePath('/manager/dashboard');
  // Лидер меняет статус из своего кабинета (/leader/orders/[id]) — инвалидируем и leader-маршруты (R3).
  revalidatePath(`/leader/orders/${parsed.data.orderId}`);
  revalidatePath('/leader/orders');
  revalidatePath('/leader/dashboard');
  return { ok: true, changed: result.changed };
}
