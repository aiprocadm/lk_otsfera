'use server';

import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { updateInternalPhone, type UpdateInternalPhoneResult } from '@/lib/services/staff/profile';

/**
 * Тонкий адаптер над `updateInternalPhone` (src/lib/services/staff/profile.ts):
 * гард роли здесь, нормализация и запись — в сервисе.
 */
export async function updateInternalPhoneAction(args: {
  internalPhone: string;
}): Promise<UpdateInternalPhoneResult> {
  const session = await requireManager();
  return updateInternalPhone(prisma, session, args);
}
