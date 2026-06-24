'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { setValues } from '@/lib/services/customFields';
import type { ValuesError } from '@/lib/services/customFields';

type ActionResult = { ok: true } | { ok: false; error: ValuesError };

/**
 * Server action: upsert custom field values for an order.
 *
 * The underlying setValues service enforces write permission:
 *   - admin: allowed for any order
 *   - manager/leader: allowed only if the order is in their scope
 *   - organization, partner, student: forbidden
 *
 * On success, revalidates the order detail path for all roles that may have
 * cached it so the section re-renders with fresh values.
 */
export async function saveOrderCustomFieldsAction(
  orderId: string,
  values: Record<string, string | null>
): Promise<ActionResult> {
  const session = await requireSession();
  const result = await setValues(prisma, session, 'order', orderId, values);
  if (!result.ok) return result;

  revalidatePath(`/manager/orders/${orderId}`);
  revalidatePath(`/leader/orders/${orderId}`);
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}
