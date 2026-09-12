import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import type { DialogStatus } from './list';
import { isDialogInScope } from './scope';

export type SetDialogStatusArgs = { dialogId: string; status: DialogStatus };

export type SetDialogStatusResult =
  { ok: true; changed: boolean } | { ok: false; error: 'not_found' };

/**
 * Закрыть диалог / открыть снова (спека 2026-09-12 §5.2). Закрытый диалог
 * уходит из списка «открытых», но новое входящее переоткроет его само
 * (`appendInboundToDialog`). Повтор того же состояния — не ошибка и не
 * событие аудита. Чужой диалог — `not_found`, как и карточка.
 */
export async function setDialogStatus(
  prisma: PrismaClient,
  session: SessionPayload,
  args: SetDialogStatusArgs
): Promise<SetDialogStatusResult> {
  const dialog = await prisma.messengerDialog.findUnique({
    where: { id: args.dialogId },
    select: { id: true, companyId: true, status: true },
  });
  if (!dialog || !isDialogInScope(session, dialog)) return { ok: false, error: 'not_found' };
  if (dialog.status === args.status) return { ok: true, changed: false };

  await prisma.messengerDialog.update({
    where: { id: dialog.id },
    data: { status: args.status },
  });
  await recordAudit(prisma, {
    action: args.status === 'closed' ? 'messenger_dialog_closed' : 'messenger_dialog_reopened',
    entity: 'messenger_dialog',
    entityId: dialog.id,
    userId: session.sub,
  });
  return { ok: true, changed: true };
}
