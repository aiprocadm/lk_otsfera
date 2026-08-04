'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { markWelcomeSeen } from '@/lib/services/account/welcome';

/**
 * Скрытие одноразового welcome-блока (этап 4, ФТ-10.4): ставит себе
 * `welcomeSeenAt` — блок больше не показывается. Только клиентские роли:
 * у staff-дашбордов блока нет.
 */
export async function dismissWelcomeAction(): Promise<{ ok: boolean }> {
  const session = await requireSession();
  if (session.role !== 'organization' && session.role !== 'partner') {
    return { ok: false };
  }
  await markWelcomeSeen(prisma, session);
  revalidatePath(session.role === 'partner' ? '/partner/dashboard' : '/organization/dashboard');
  return { ok: true };
}
