'use server';

import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { saveNotificationPreference } from '@/lib/services/notifications/eventPreferences';

/**
 * Личные настройки «событие × канал» (`У-229`). Тонкий адаптер над сервисом:
 * сессия и флаг здесь, правило «только сужать» — в сервисе.
 */
export async function saveNotificationPreferenceAction(eventType: string, channels: string[]) {
  const session = await requireSession();
  // `Р-Э5-8`: матрица принадлежит новому экрану — без флага её нет.
  if (!isFeatureEnabled('notification_center'))
    return { ok: false as const, error: 'feature_disabled' as const };
  return saveNotificationPreference(prisma, session, { eventType, channels });
}
