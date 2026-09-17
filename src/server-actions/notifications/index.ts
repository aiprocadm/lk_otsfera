'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { markAllNotificationsRead } from '@/lib/services/notifications/inbox';
import type { ActionResult } from '@/lib/actions/form';

/**
 * Действия страницы «Уведомления» (`У-228`).
 *
 * Тонкий адаптер над сервисом (§3): скоуп и правило «только своё» живут в
 * `markAllNotificationsRead`, здесь — сессия, флаг и сброс кэша страницы.
 */
export async function markAllNotificationsReadAction(
  cabinetPath: string
): Promise<ActionResult<'feature_disabled'> & { count?: number }> {
  const session = await requireSession();
  // `Р-Э5-8`: действие принадлежит новому экрану — без флага его нет.
  if (!isFeatureEnabled('notification_center')) return { ok: false, error: 'feature_disabled' };
  void session;
  const res = await markAllNotificationsRead(prisma, session);
  revalidatePath(cabinetPath);
  return { ok: true, count: res.updated.count };
}
