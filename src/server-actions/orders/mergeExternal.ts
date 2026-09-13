'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import {
  listMergeTargets,
  mergeExternalOrderInto,
  type MergeExternalResult,
  type MergeTarget,
} from '@/lib/services/orders/mergeExternal';

/**
 * «Это тот же заказ, что …» (`У-197`, `В-2-4`): объединение заказа из
 * Битрикс24 с заказом 1С. Права проверяет сервис (`admin` или руководитель
 * своей компании) — действие лишь разбирает вход и обновляет экраны.
 */
const MergeSchema = z.object({
  sourceOrderId: z.string().min(1).max(64),
  targetOrderId: z.string().min(1).max(64),
});

export async function mergeExternalOrderAction(
  input: z.input<typeof MergeSchema>
): Promise<MergeExternalResult | { ok: false; error: 'validation' }> {
  const parsed = MergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const result = await mergeExternalOrderInto(prisma, session, parsed.data);
  if (result.ok) {
    // Исходный заказ исчез, целевой пополнился: обновляем оба адреса во всех
    // кабинетах сотрудников, иначе человек увидит удалённый заказ живым.
    for (const cabinet of ['admin', 'leader', 'manager']) {
      revalidatePath(`/${cabinet}/orders/${parsed.data.sourceOrderId}`);
      revalidatePath(`/${cabinet}/orders/${parsed.data.targetOrderId}`);
      revalidatePath(`/${cabinet}/orders`);
    }
  }
  return result;
}

export type MergeTargetsResult =
  | { ok: true; targets: MergeTarget[] }
  | { ok: false; error: string };

/** Кандидаты для объединения — заказы 1С той же организации. */
export async function listMergeTargetsAction(sourceOrderId: string): Promise<MergeTargetsResult> {
  if (!sourceOrderId) return { ok: false, error: 'validation' };
  const session = await requireSession();
  return listMergeTargets(prisma, session, sourceOrderId);
}
