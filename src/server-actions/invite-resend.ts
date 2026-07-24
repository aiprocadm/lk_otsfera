'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { resendInvite, type ResendInviteResult } from '@/lib/services/team/resend';

/**
 * Повторная отправка приглашения (этап 4, ФТ-10.2) — тонкий адаптер (§3):
 * скоупы по ролям целиком в сервисе resendInvite.
 */
export async function resendInviteAction(args: {
  userId: string;
  sendEmail?: boolean;
}): Promise<ResendInviteResult> {
  const session = await requireSession();
  const userId = typeof args?.userId === 'string' ? args.userId : '';
  if (!userId) return { ok: false, error: 'not_found' };
  return resendInvite(prisma, session, { userId, sendEmail: args?.sendEmail !== false });
}
