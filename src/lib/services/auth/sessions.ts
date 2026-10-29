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
  await bumpSessionVersion(prisma, session, 'sessions_revoked');
  return { ok: true };
}

/**
 * Выход из кабинета (`У-324`, ТЗ 28.10.2026, ДП §1 п. 5). Раньше выход только
 * стирал cookie, а сам токен оставался действительным до 7 дней: украденный
 * до выхода токен продолжал открывать кабинет. Теперь выход — тот же отзыв,
 * что «Выйти на всех устройствах»: версия растёт, и все выданные пользователю
 * токены, включая скопированный, перестают приниматься.
 *
 * Сознательная цена: выход на одном устройстве завершает сессии и на других.
 * Список отозванных токенов (по `jti`) дал бы точечный выход, но это новая
 * таблица и запрос на каждый вход в кабинет — ради редкого случая.
 */
export async function endSessionOnLogout(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true }> {
  await bumpSessionVersion(prisma, session, 'logout');
  return { ok: true };
}

async function bumpSessionVersion(
  prisma: PrismaClient,
  session: SessionPayload,
  action: 'sessions_revoked' | 'logout'
): Promise<void> {
  await prisma.user.update({
    where: { id: session.sub },
    data: { sessionVersion: { increment: 1 } },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action,
    entity: 'user',
    entityId: session.sub,
  }).catch(bestEffort(`[auth/sessions] audit failed (${action})`));
}
