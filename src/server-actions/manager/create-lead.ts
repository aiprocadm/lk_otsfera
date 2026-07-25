'use server';

import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { createLeadByStaff, type CreateLeadByStaffInput } from '@/lib/services/manager/createLead';

export type CreateLeadByStaffActionResult =
  | { ok: true; leadId: string }
  | { ok: false; error: 'forbidden' | 'validation'; messages?: string[] };

/**
 * Ручное создание лида сотрудником (этап 5, ФТ-1.6) — тонкий адаптер над
 * `createLeadByStaff`: роль/скоуп проверяет сервис (manager|admin, C8).
 */
export async function createLeadByStaffAction(
  input: CreateLeadByStaffInput
): Promise<CreateLeadByStaffActionResult> {
  const session = await requireSession();
  const res = await createLeadByStaff(prisma, session, input);
  if (!res.ok) {
    return { ok: false, error: res.error, ...(res.messages ? { messages: res.messages } : {}) };
  }
  return { ok: true, leadId: res.lead.id };
}
