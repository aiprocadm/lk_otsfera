'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { transitionOrderStatus } from '@/lib/services/orderStatuses';
import type { CompletionCondition } from '@/lib/orders/completion';

const Schema = z.object({
  orderId: z.string().min(1),
  toId: z.string().min(1),
  reason: z.string().max(1000).optional(),
});

export type TransitionStatusActionResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      error:
        | 'validation'
        | 'not_found'
        | 'forbidden'
        | 'invalid_status'
        | 'status_inactive'
        | 'reason_required'
        | 'backward_forbidden';
    }
  | { ok: false; error: 'completion_conditions_unmet'; unmet: CompletionCondition[] };

/**
 * §10 ТЗ v0.5 — смена рабочего статуса заявки из карточки.
 *
 * Права проверяет сервис (доступ к заявке + порядок + роль); экшен ничего не
 * решает сам, иначе появился бы второй источник правды.
 */
export async function transitionOrderStatusAction(input: {
  orderId: string;
  toId: string;
  reason?: string;
}): Promise<TransitionStatusActionResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireSession();
  const res = await transitionOrderStatus(prisma, session, parsed.data);
  if (!res.ok) return res;

  // Одна и та же заявка живёт в трёх кабинетах — освежаем все, иначе соседний
  // покажет старый статус из кэша.
  for (const path of [
    `/manager/orders/${input.orderId}`,
    '/manager/orders',
    `/leader/orders/${input.orderId}`,
    '/leader/orders',
    `/admin/orders/${input.orderId}`,
  ]) {
    revalidatePath(path);
  }

  return { ok: true, changed: res.changed };
}
