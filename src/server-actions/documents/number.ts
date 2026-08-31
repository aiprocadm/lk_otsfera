'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { setDocumentNumber } from '@/lib/services/documents/number';

/**
 * Этап 6 (`У-151`, дефект `Д-5`) — вписать номер документу, приехавшему из 1С.
 *
 * Адаптер тонкий: форма входа здесь, права и проверка занятости номера — в
 * сервисе. Кнопка на экране показывается только у документа без номера, но
 * запрет живёт в сервисе: скрытая кнопка защитой не является (§4).
 */
export type SetDocumentNumberResult = Awaited<ReturnType<typeof setDocumentNumber>>;

export async function setDocumentNumberAction(fd: FormData): Promise<SetDocumentNumberResult> {
  const session = await requireSession();
  const documentId =
    typeof fd.get('documentId') === 'string' ? (fd.get('documentId') as string) : '';
  const number = typeof fd.get('number') === 'string' ? (fd.get('number') as string) : '';

  const res = await setDocumentNumber(prisma, session, { documentId, number });
  if (res.ok) revalidatePath(`/${session.role}/documents/${documentId}`);
  return res;
}
