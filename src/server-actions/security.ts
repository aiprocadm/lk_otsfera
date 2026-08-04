'use server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { revokeAllSessions } from '@/lib/services/auth/sessions';

/**
 * Этап 9 (ФТ-11.2) — «Выйти на всех устройствах». Инкремент `User.sessionVersion`
 * (в сервисе `revokeAllSessions`) рассинхронизирует клейм во всех ранее выданных
 * 7-дневных токенах, и getSession перестаёт их принимать. Текущее устройство тоже
 * выходит: своя cookie удаляется, а старый токен всё равно уже недействителен —
 * карточка уводит на /login.
 * Доступно всем ролям (домен один — собственные сессии), гейт — наличие сессии.
 */
export async function revokeAllSessionsAction(): Promise<
  { ok: true } | { ok: false; error: 'forbidden' }
> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'forbidden' };

  await revokeAllSessions(prisma, session);

  (await cookies()).delete('session');
  return { ok: true };
}
