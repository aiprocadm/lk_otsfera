import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Скрытие одноразового welcome-блока (этап 4, ФТ-10.4): ставит `welcomeSeenAt`
 * СВОЕМУ пользователю — id берётся из сессии, аргументом не передаётся, чужую
 * карточку этим не погасить.
 *
 * Гейт ролей и выбор дашборда для revalidate остаются в server-action: это
 * маршрутная часть, а не доменная.
 */
export async function markWelcomeSeen(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true }> {
  await prisma.user.update({
    where: { id: session.sub },
    data: { welcomeSeenAt: new Date() },
  });
  return { ok: true };
}
