import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { DIALOG_STATUS, waitingSinceFor } from './dialogStatus';
import type { MANUAL_DIALOG_STATUSES } from './dialogStatus';
import { isDialogInScope } from './scope';

/** Что сотрудник выставляет кнопкой: закрыть или открыть снова (У-207). */
type ManualDialogStatus = (typeof MANUAL_DIALOG_STATUSES)[number];

export type SetDialogStatusArgs = { dialogId: string; status: ManualDialogStatus };

export type SetDialogStatusResult =
  { ok: true; changed: boolean } | { ok: false; error: 'not_found' };

/**
 * Закрыть диалог / открыть снова (спека 2026-09-12 §5.2). Закрытый диалог
 * уходит из списка «открытых», но новое входящее переоткроет его само
 * (`appendInboundToDialog`). Повтор того же состояния — не ошибка и не
 * событие аудита. Чужой диалог — `not_found`, как и карточка.
 *
 * Промежуточные статусы (`waiting_staff`/`waiting_client`) руками не ставятся —
 * их считает автомат по событиям переписки (`dialogStatus.ts`). Поэтому любое
 * ручное действие сбрасывает отсчёт ожидания: сотрудник либо закрыл разговор,
 * либо открыл его заново — в обоих случаях прежняя просрочка неактуальна.
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
    data: { status: args.status, waitingSince: waitingSinceFor(args.status, null, new Date()) },
  });
  await recordAudit(prisma, {
    action:
      args.status === DIALOG_STATUS.closed
        ? 'messenger_dialog_closed'
        : 'messenger_dialog_reopened',
    entity: 'messenger_dialog',
    entityId: dialog.id,
    userId: session.sub,
  });
  return { ok: true, changed: true };
}
