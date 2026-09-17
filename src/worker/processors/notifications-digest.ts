import { runNotificationDigest, type DigestRunSummary } from '@/lib/services/notifications/digest';

/**
 * Процессор очереди `notifications.digest` (этап 5 ТЗ 12.09.2026, `У-230`):
 * ежечасно по Москве собирает дневной дайджест тем, у кого час совпал.
 * Правило целиком — в сервисе `services/notifications/digest.ts`; здесь только
 * клиент базы и текущее время.
 */
export async function notificationsDigestProcessor(): Promise<DigestRunSummary> {
  const { prisma } = await import('@/lib/db/prisma');
  return runNotificationDigest(prisma, new Date());
}
