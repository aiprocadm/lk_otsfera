import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/** Данные одноразового welcome-блока (ФТ-10.4): имя + отметка «уже скрыт». */
type WelcomeViewer = { name: string; welcomeSeenAt: Date | null };

/**
 * Зритель welcome-блока дашбордов организации и партнёра. Читает **только
 * себя** (`session.sub`) — чужой профиль этой функцией не достать.
 * `null` = пользователя нет (сессия пережила удаление) → блок не рендерится.
 */
export async function getWelcomeViewer(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<WelcomeViewer | null> {
  return prisma.user.findUnique({
    where: { id: session.sub },
    select: { name: true, welcomeSeenAt: true },
  });
}
