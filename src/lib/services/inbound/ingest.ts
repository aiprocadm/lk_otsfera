import { Prisma, type PrismaClient } from '@prisma/client';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';
import { isDialogChannel } from '@/lib/services/messengers/channels';
import { normalizeChannelValue } from '@/lib/services/contacts/resolveContactByChannel';
import { appendInboundToDialog } from '@/lib/services/messengers/appendInbound';
import { resolveInboundSender } from './resolve';

export type InboundDto = {
  // Этап 9 (ФТ-11.1): `cabinet` — вопрос из личного кабинета клиента.
  channel: 'telegram' | 'max' | 'whatsapp' | 'email' | 'cabinet';
  externalId: string;
  senderRef: string;
  senderDisplay?: string | null | undefined;
  subject?: string | undefined;
  body: string;
  attachmentPath?: string | undefined;
  attachmentName?: string | undefined;
  attachmentMime?: string | undefined;
  /** Размер скачанного файла — для подписи в ленте диалога (`У-204`). */
  attachmentSize?: number | undefined;
  /** `Message-ID` письма (`У-205`) — сшивка ответа с перепиской. */
  externalMessageId?: string | null | undefined;
  /**
   * Этап 9: отправитель уже известен (кабинет — сессия клиента), резолв по
   * каналу не нужен. Статус остаётся `unresolved`: критерий Intake — именно
   * неразобранные единицы (ФТ-8.1), а привязка к орг/пользователю лишь
   * показывает сотруднику, от кого обращение.
   */
  sender?: {
    userId: string;
    organizationId: string | null;
    companyId: string | null;
  };
};
export type IngestResult =
  | { ok: true; id: string; deduped: boolean }
  // 'storage' reserved for the upcoming attachment-upload step (S3) — do not prune as dead.
  | { ok: false; error: 'storage' };

export async function ingestInboundMessage(
  prisma: PrismaClient,
  dto: InboundDto
): Promise<IngestResult> {
  const existing = await prisma.inboundMessage.findUnique({
    where: { externalId: dto.externalId },
    select: { id: true },
  });
  if (existing) {
    await writeSyncLog(
      {
        entity: 'inbound',
        externalId: dto.externalId,
        direction: 'inbound',
        operation: 'skip',
        status: 'success',
      },
      prisma
    );
    return { ok: true, id: existing.id, deduped: true };
  }

  // Адрес приводим к единому виду ЗДЕСЬ, а не у вызывающего: `senderRef`
  // строки письма и `peerRef` диалога должны совпадать всегда. Иначе привязка
  // диалога (`bind.ts` ищет письма условием `senderRef = peerRef`) не найдёт
  // письма со смешанным регистром, и они останутся неразобранными.
  const senderRef =
    dto.channel === 'email' ? normalizeChannelValue('email', dto.senderRef) : dto.senderRef;

  const resolved = dto.sender
    ? ({ matchType: 'known-sender' } as const)
    : await resolveInboundSender(prisma, {
        // Сюда попадают только внешние каналы: у кабинета отправитель известен (dto.sender).
        channel: dto.channel as 'telegram' | 'max' | 'whatsapp' | 'email',
        chatId: dto.channel === 'telegram' || dto.channel === 'max' ? senderRef : undefined,
        phone: dto.channel === 'whatsapp' ? senderRef : undefined,
        email: dto.channel === 'email' ? senderRef : undefined,
      });

  let row: { id: string };
  try {
    row = await prisma.inboundMessage.create({
      data: {
        channel: dto.channel,
        externalId: dto.externalId,
        externalMessageId: dto.externalMessageId ?? null,
        senderRef,
        senderDisplay: dto.senderDisplay ?? null,
        subject: dto.subject ?? null,
        body: dto.body,
        attachmentPath: dto.attachmentPath ?? null,
        attachmentName: dto.attachmentName ?? null,
        attachmentMime: dto.attachmentMime ?? null,
        scanStatus: dto.attachmentPath ? 'pending' : 'none',
        ...(dto.sender
          ? {
              // Известный отправитель (кабинет): привязка есть, но разбор — за сотрудником.
              resolvedUserId: dto.sender.userId,
              resolvedOrgId: dto.sender.organizationId,
              companyId: dto.sender.companyId,
              status: 'unresolved',
            }
          : resolved.matchType === 'exact'
            ? {
                resolvedOrgId: resolved.orgId,
                resolvedUserId: resolved.userId ?? null,
                contactId: resolved.contactId ?? null,
                companyId: resolved.companyId,
                status: 'bound',
                boundAt: new Date(),
              }
            : { status: 'unresolved' }),
      },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await prisma.inboundMessage.findUnique({
        where: { externalId: dto.externalId },
        select: { id: true },
      });
      await writeSyncLog(
        {
          entity: 'inbound',
          externalId: dto.externalId,
          direction: 'inbound',
          operation: 'skip',
          status: 'success',
        },
        prisma
      );
      return { ok: true, id: raced?.id ?? '', deduped: true };
    }
    throw err;
  }

  await writeSyncLog(
    {
      entity: 'inbound',
      externalId: dto.externalId,
      direction: 'inbound',
      operation: 'create',
      status:
        resolved.matchType === 'exact' || resolved.matchType === 'known-sender'
          ? 'success'
          : 'warn',
      errorMessage:
        resolved.matchType === 'exact' || resolved.matchType === 'known-sender'
          ? undefined
          : 'unresolved',
    },
    prisma
  );

  // Диалог (спека 2026-09-12, Р-М-1; расширено `У-205`): сообщение из
  // Telegram/MAX/WhatsApp — и с этапа 3 письмо — это ещё и реплика диалога с
  // собеседником. Best-effort (§3): сообщение уже записано и попадёт во
  // «Входящие в работу», а пропущенную реплику дочинит
  // `backfillDialogsFromInbound` — вебхук при этом отвечает 200 и не ретраит.
  //
  // Ключ диалога у почты — НОРМАЛИЗОВАННЫЙ адрес (тем же правилом, что ищет
  // контакт по каналу). Иначе `Ivan@Mail.RU` и `ivan@mail.ru` завели бы два
  // разных диалога с одним человеком — на этом классе ошибок уже спотыкался
  // этап 2 (телефон и ИНН в сопоставлении).
  if (isDialogChannel(dto.channel)) {
    try {
      await appendInboundToDialog(prisma, {
        inboundMessageId: row.id,
        channel: dto.channel,
        peerRef: senderRef,
        peerDisplay: dto.senderDisplay,
        body: dto.body,
        externalId: dto.externalId,
        // У-204: файл клиента виден и в ленте диалога, не только во «Входящих».
        ...(dto.attachmentPath && dto.attachmentName && dto.attachmentMime
          ? {
              attachment: {
                path: dto.attachmentPath,
                name: dto.attachmentName,
                mimeType: dto.attachmentMime,
                size: dto.attachmentSize ?? 0,
              },
            }
          : {}),
        binding:
          resolved.matchType === 'exact'
            ? {
                companyId: resolved.companyId,
                organizationId: resolved.orgId,
                contactId: resolved.contactId ?? null,
                userId: resolved.userId ?? null,
              }
            : null,
      });
    } catch (err) {
      log.error('[inbound/ingest] dialog append failed', {
        inboundMessageId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Best-effort: enqueue ClamAV scan for the attachment. Failure leaves
  // scanStatus='pending', where the backfill sweep will pick it up later
  // (CLAUDE.md §3 — queue enqueue is logged and swallowed, never blocks ingest).
  if (dto.attachmentPath) {
    try {
      const payload: ScanDocumentPayload = { kind: 'inbound_attachment', id: row.id };
      await getQueue('docs.scanDocument').add('scan', payload);
    } catch (err) {
      log.warn('[inbound/ingest] enqueue scan failed', {
        inboundMessageId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true, id: row.id, deduped: false };
}
