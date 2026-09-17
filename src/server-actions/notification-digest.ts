'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { updateDigestSettings } from '@/lib/services/notifications/digest';

/**
 * Галочка «Получать письма дайджестом раз в день» и час (`У-230`).
 * Под флагом `notification_center` (`Р-Э5-8`); роль проверяет сервис (§4).
 */
export async function updateDigestSettingsAction(enabled: boolean, hourMsk: number) {
  const session = await requireSession();
  if (!isFeatureEnabled('notification_center')) {
    return { ok: false as const, error: 'feature_disabled' as const };
  }
  return updateDigestSettings(prisma, session, { enabled, hourMsk });
}
