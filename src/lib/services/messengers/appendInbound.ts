import type { PrismaClient } from '@prisma/client';
import { bestEffort } from '@/lib/logging';
import { notifyManagersMessengerMessage } from '@/lib/notifications/manager';
import { MESSENGER_LABELS, type MessengerChannel } from './channels';
import { previewOf, upsertDialog } from './dialog';
import { DIALOG_STATUS, nextStatusOnInbound, waitingSinceFor } from './dialogStatus';

/** Кому принадлежит собеседник, если резолвер его узнал. */
type DialogBinding = {
  companyId: string;
  organizationId: string | null;
  contactId: string | null;
  userId: string | null;
};

export type AppendInboundArgs = {
  /** Письмо «Входящих», из которого складывается реплика; в диалоге — один раз. */
  inboundMessageId: string;
  channel: MessengerChannel;
  peerRef: string;
  peerDisplay?: string | null | undefined;
  body: string;
  externalId: string;
  /** Время сообщения у провайдера; без него — момент записи. */
  sentAt?: Date | null | undefined;
  /** null — отправитель не распознан: диалог ждёт привязки в общей очереди. */
  binding: DialogBinding | null;
  /**
   * Считать ли сообщение непрочитанным. Бэкфилл старых писем передаёт `false`:
   * они лежали во «Входящих» неделями, и сотни красных бейджей в день запуска —
   * шум, а не сигнал. Он же выключает уведомление менеджерам (Р-М-9).
   */
  markUnread?: boolean | undefined;
};

export type AppendInboundResult = {
  ok: true;
  dialogId: string;
  messageId: string;
  /** Реплика уже была в диалоге (повторный вызов) — ничего не записано. */
  deduped: boolean;
};

/**
 * Входящее из мессенджера → реплика диалога (Р-М-1). Зовётся из
 * `ingestInboundMessage` после записи письма и из бэкфилла.
 *
 * Порядок: (1) идемпотентность по письму, (2) upsert диалога по собеседнику —
 * новый открыт с этим сообщением, существующий переоткрывается и получает
 * свежее превью, (3) привязка, если диалог ещё ничей, а отправитель узнан
 * (уже привязанный диалог резолвер не перепривязывает — это право сотрудника),
 * (4) само сообщение, (5) уведомление менеджерам организации диалога —
 * best-effort: оно не важнее самой реплики.
 */
export async function appendInboundToDialog(
  prisma: PrismaClient,
  args: AppendInboundArgs
): Promise<AppendInboundResult> {
  const existing = await prisma.messengerMessage.findUnique({
    where: { inboundMessageId: args.inboundMessageId },
    select: { id: true, dialogId: true },
  });
  if (existing)
    return { ok: true, dialogId: existing.dialogId, messageId: existing.id, deduped: true };

  const at = args.sentAt ?? new Date();
  const preview = previewOf(args.body);
  const live = args.markUnread !== false;
  const unread = live ? 1 : 0;
  const bindingData = args.binding
    ? {
        companyId: args.binding.companyId,
        organizationId: args.binding.organizationId,
        contactId: args.binding.contactId,
        userId: args.binding.userId,
      }
    : {};

  const dialog = await upsertDialog(
    prisma,
    { channel: args.channel, peerRef: args.peerRef },
    {
      create: {
        peerDisplay: args.peerDisplay ?? null,
        ...bindingData,
        // Бэкфилл (`markUnread: false`) сворачивает письма многолетней
        // давности. Он не поднимает счётчик непрочитанных — и по той же
        // причине не ставит диалог в ожидание: иначе первый же прогон
        // эскалации завалил бы руководителей «просрочками» по перепискам,
        // на которые давно ответили (исходящие бэкфилл не сворачивает, и
        // снять такой статус было бы нечем).
        status: live ? nextStatusOnInbound() : DIALOG_STATUS.open,
        waitingSince: live ? waitingSinceFor(nextStatusOnInbound(), null, at) : null,
        lastMessageAt: at,
        lastInboundAt: at,
        lastMessagePreview: preview,
        lastMessageDirection: 'in',
        unreadCount: unread,
      },
      update: {
        // `waitingSince` в update намеренно нет: отсчёт ожидания ставится ниже
        // и только если он ещё не идёт — иначе каждое следующее сообщение
        // клиента обнуляло бы просрочку, и диалог никогда бы не «покраснел».
        // Бэкфилл статуса не касается вовсе (см. комментарий в `create`).
        ...(live ? { status: nextStatusOnInbound() } : {}),
        lastMessageAt: at,
        lastInboundAt: at,
        lastMessagePreview: preview,
        lastMessageDirection: 'in',
        unreadCount: { increment: unread },
        // Имя собеседника обновляем только когда провайдер его прислал —
        // пустое поле не должно стирать известное имя.
        ...(args.peerDisplay ? { peerDisplay: args.peerDisplay } : {}),
      },
    }
  );

  // Отсчёт ожидания ответа (У-207): ставим, только если он ещё не идёт.
  // Условие в `where`, а не в коде: между upsert и этим шагом ответить мог
  // другой сотрудник, и тогда ожидание уже сброшено — перетирать нельзя.
  if (live && dialog.waitingSince === null) {
    await prisma.messengerDialog.updateMany({
      where: { id: dialog.id, waitingSince: null },
      data: { waitingSince: at },
    });
  }

  // Привязка по распознаванию — только ничьему диалогу. Условие в `where`, а не
  // в коде: между upsert и этим шагом диалог мог привязать сотрудник.
  let organizationId = dialog.organizationId;
  if (args.binding && dialog.companyId === null) {
    const bound = await prisma.messengerDialog.updateMany({
      where: { id: dialog.id, companyId: null },
      data: bindingData,
    });
    if (bound.count > 0) organizationId = args.binding.organizationId;
  }

  const message = await prisma.messengerMessage.create({
    data: {
      dialogId: dialog.id,
      direction: 'in',
      body: args.body,
      inboundMessageId: args.inboundMessageId,
      externalId: args.externalId,
      createdAt: at,
    },
    select: { id: true },
  });

  // Р-М-9 + У-206: о входящем узнаёт ответственный за диалог, а если его нет —
  // менеджеры организации. Диалог без того и другого никого не дёргает: он
  // виден во «Входящих в работу» и в бейдже «ждут ответа». Бэкфилл старые
  // письма не рассылает.
  if (live && (dialog.assigneeId || organizationId)) {
    await notifyManagersMessengerMessage(prisma, {
      organizationId,
      assigneeId: dialog.assigneeId,
      dialogId: dialog.id,
      // Имя — из этого письма, иначе то, что диалог уже знает, иначе адрес.
      peerLabel: args.peerDisplay?.trim() || dialog.peerDisplay?.trim() || args.peerRef,
      channelLabel: MESSENGER_LABELS[args.channel],
      excerpt: preview,
    }).catch(bestEffort('[messengers/appendInbound] notify managers failed'));
  }

  return { ok: true, dialogId: dialog.id, messageId: message.id, deduped: false };
}
