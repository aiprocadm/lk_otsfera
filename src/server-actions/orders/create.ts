'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { createOrderDirect, type CreateOrderError } from '@/lib/services/manager/orderCreate';

const Schema = z.object({
  organizationId: z.string().min(1).max(64),
  title: z.string().max(200),
  serviceType: z.enum(['training', 'document_development']),
});

/**
 * «Создать заказ» без лида (этап 6 ТЗ 13.10.2026, `У-306`). Форма входа —
 * здесь, права и охват организации — в сервисе.
 */
export async function createOrderAction(
  input: z.input<typeof Schema>
): Promise<{ ok: true; orderId: string } | { ok: false; error: CreateOrderError }> {
  const session = await requireSession();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const res = await createOrderDirect(prisma, session, parsed.data);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/manager/orders');
  revalidatePath('/leader/orders');
  return { ok: true, orderId: res.orderId };
}
