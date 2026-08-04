import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Профиль сотрудника — чтение для страницы настроек кабинета менеджера.
 *
 * Пока в профиле одно поле: внутренний (АТС-добавочный) номер, с которого Mango
 * инициирует click-to-call (M2). Запись — зеркальный `updateInternalPhoneAction`
 * в `src/server-actions/staff-profile.ts`.
 *
 * Скоуп: строго свой пользователь (`session.sub`) — чужие профили этим сервисом
 * не читаются, поэтому дополнительной проверки прав не требуется (гард роли
 * остаётся на странице/в server-action).
 */
export async function getStaffInternalPhone(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<string | null> {
  const me = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { internalPhone: true },
  });
  return me?.internalPhone ?? null;
}
