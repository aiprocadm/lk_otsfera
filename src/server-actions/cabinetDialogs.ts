'use server';

import { revalidatePath } from 'next/cache';
import { str } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { replyFromCabinet, type CabinetReplyResult } from '@/lib/services/cabinetDialogs/reply';

/**
 * `У-234` — отправка сообщения менеджеру из кабинета. Тонкий адаптер (§3):
 * роль проверяет сервис (`submitCabinetQuestion` отвечает `forbidden` всем,
 * кроме заказчика и партнёра), лимиты текста — он же.
 */
export async function replyFromCabinetAction(fd: FormData): Promise<CabinetReplyResult> {
  const session = await requireSession();
  const res = await replyFromCabinet(prisma, session, str(fd, 'text'));
  if (!res.ok) return res;
  revalidatePath('/organization/messages');
  revalidatePath('/partner/messages');
  return { ok: true };
}
