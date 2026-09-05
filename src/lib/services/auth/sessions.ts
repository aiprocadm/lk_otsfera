import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { bestEffort } from '@/lib/logging';

/**
 * «Выйти на всех устройствах» (этап 9, ФТ-11.2). Инкремент `User.sessionVersion`
 * рассинхронизирует клейм во всех ранее выданных токенах — `getSession`
 * перестаёт их принимать.
 *
 * Действие всегда над СВОИМ пользователем: id берётся из сессии, аргументом не
 * передаётся, поэтому чужую сессию этим сервисом не отозвать. Удаление cookie
 * текущего устройства — забота вызывающего (это Next-specific шаг).
 *
 * Аудит best-effort: сбой журнала не откатывает отзыв (§3).
 */
export async function revokeAllSessions(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true }> {
  await prisma.user.update({
    where: { id: session.sub },
    data: { sessionVersion: { increment: 1 } },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'sessions_revoked',
    entity: 'user',
    entityId: session.sub,
  }).catch(bestEffort('[auth/sessions] audit failed (sessions_revoked)'));

  return { ok: true };
}
