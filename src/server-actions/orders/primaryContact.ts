'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import {
  setOrderPrimaryContact,
  type SetOrderPrimaryContactResult,
} from '@/lib/services/orders/primaryContact';

const Schema = z.object({
  orderId: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64).nullable(),
});

/**
 * «Контакт заказа» (`У-180`): назначить или снять (`contactId: null`). Флаг
 * `contacts` — поведенческий (`forbidden` при выключенном); скоуп заказа и
 * контакта проверяет сервис, здесь — форма входа, сессия и свежий `teamMode`.
 */
export async function setOrderPrimaryContactAction(
  input: z.input<typeof Schema>
): Promise<SetOrderPrimaryContactResult | { ok: false; error: 'validation' }> {
  if (notFoundIfDisabled('contacts')) return { ok: false, error: 'forbidden' };
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const result = await setOrderPrimaryContact(prisma, session, teamMode, parsed.data);
  if (result.ok) {
    for (const cabinet of ['manager', 'leader', 'admin']) {
      revalidatePath(`/${cabinet}/orders/${parsed.data.orderId}`);
      if (parsed.data.contactId) revalidatePath(`/${cabinet}/contacts/${parsed.data.contactId}`);
    }
  }
  return result;
}
