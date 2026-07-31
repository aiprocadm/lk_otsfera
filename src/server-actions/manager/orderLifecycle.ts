'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { setOrderAccountingSigned } from '@/lib/services/manager/orderLifecycle';

/**
 * §10 ТЗ v0.5 (этап 2, PR-4): экшен перехода статуса отсюда удалён — статус
 * меняется через `server-actions/orderStatuses.ts` поверх справочника.
 * Осталась отметка бухгалтерии: это событие, а не статус.
 */
function revalidateOrder(orderId: string): void {
  revalidatePath(`/manager/orders/${orderId}`);
  revalidatePath('/manager/orders');
  revalidatePath(`/leader/orders/${orderId}`);
  revalidatePath('/leader/orders');
}

const AccountingSchema = z.object({
  orderId: z.string().min(1),
  signed: z.boolean(),
});

export type SetAccountingSignedActionResult =
  { ok: true; changed: boolean } | { ok: false; error: 'validation' | 'not_found' | 'forbidden' };

export async function setOrderAccountingSignedAction(input: {
  orderId: string;
  signed: boolean;
}): Promise<SetAccountingSignedActionResult> {
  const parsed = AccountingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation' };
  }

  const session = await requireManager();
  const result = await setOrderAccountingSigned(prisma, session, parsed.data);
  if (!result.ok) return result;

  revalidateOrder(parsed.data.orderId);
  return { ok: true, changed: result.changed };
}
