import type { PrismaClient } from '@prisma/client';
import { bestEffort } from '@/lib/logging';
import { notifyManagersMessengerMessage } from '@/lib/notifications/manager';
import { MESSENGER_LABELS, type MessengerChannel } from './channels';
import { previewOf, upsertDialog } from './dialog';

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
        status: 'open',
        lastMessageAt: at,
        lastInboundAt: at,
        lastMessagePreview: preview,
        lastMessageDirection: 'in',
        unreadCount: unread,
      },
      update: {
        status: 'open',
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

  // Р-М-9: менеджеры организации узнают о входящем. Ничей диалог и так виден
  // во «Входящих в работу»; бэкфилл старые письма не рассылает.
  if (live && organizationId) {
    await notifyManagersMessengerMessage(prisma, {
      organizationId,
      dialogId: dialog.id,
      // Имя — из этого письма, иначе то, что диалог уже знает, иначе адрес.
      peerLabel: args.peerDisplay?.trim() || dialog.peerDisplay?.trim() || args.peerRef,
      channelLabel: MESSENGER_LABELS[args.channel],
      excerpt: preview,
    }).catch(bestEffort('[messengers/appendInbound] notify managers failed'));
  }

  return { ok: true, dialogId: dialog.id, messageId: message.id, deduped: false };
}
