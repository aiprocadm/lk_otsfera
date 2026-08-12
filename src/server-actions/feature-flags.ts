'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { setFeatureFlag } from '@/lib/services/admin/featureFlags';

/**
 * Переключение флага функциональности из интерфейса (`У-65`, `У-67`).
 * `enabled: null` — вернуть к значению переменной окружения.
 * Права и запрет на флаги разделов проверяет сервис (§4).
 */
export async function setFeatureFlagAction(flag: string, enabled: boolean | null) {
  const session = await requireSession();
  const res = await setFeatureFlag(prisma, session, { flag, enabled });
  if (res.ok) revalidatePath('/admin/settings/system/feature-flags');
  return res;
}
