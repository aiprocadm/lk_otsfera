import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { ALLOWED_MIME_TYPES, maxFileSizeBytes } from '@/lib/config/upload';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';
import { getObjectStorage } from '@/lib/storage';
import { SUPPORTED_MIME_TYPES, validateMagicBytes } from '@/lib/storage/mimeValidator';
import { channelAcceptsAttachment, sendAttachmentToMessenger } from './transport';
import type { DialogChannel, MessengerChannel } from './channels';
import { previewOf } from './dialog';
import { isDialogInScope } from './scope';

/**
 * Вложения диалога (`У-204`, спека этапа 3 §3.3).
 *
 * Почему не `persistUploadedDocument`: тот заводит `Document` — документ
 * заказа или контрагента, рассылает уведомления и требует заказ, которого у
 * диалога нет. Вложение диалога — часть переписки. Тот же выбор уже сделан
 * для вложений чата (`Message.attachmentPath`), здесь он повторяется.
 *
 * Проверки у файла общие с документами (`validateUploadFile` из
 * `config/upload` + отпечаток байтов): формат, размер, сигнатура.
 *
 * ГЛАВНОЕ ПРАВИЛО: исходящий файл уходит клиенту **только после `clean`**.
 * Сообщение создаётся сразу (сотрудник видит «файл проверяется»), а отправку
 * делает антивирусный процессор, когда проверка закончилась. Иначе мы бы
 * переслали клиенту заражённый файл раньше, чем узнали об этом сами.
 */

/** Предел канала: Telegram принимает файл до 50 МБ (документация Bot API). */
const CHANNEL_ATTACHMENT_LIMIT_MB: Partial<Record<DialogChannel, number>> = {
  telegram: 50,
};

/** Фактический предел для канала — меньшее из общего и канального (`В-3-1`). */
export function attachmentLimitBytes(channel: DialogChannel): number {
  const channelMb = CHANNEL_ATTACHMENT_LIMIT_MB[channel];
  const common = maxFileSizeBytes();
  return channelMb ? Math.min(common, channelMb * 1024 * 1024) : common;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Ключ файла в хранилище. Префикс проверяется при скачивании. */
const ATTACHMENT_PREFIX = 'messengers/';

function storageKey(dialogId: string, name: string): string {
  return `${ATTACHMENT_PREFIX}${dialogId}/${randomUUID()}-${sanitizeFilename(name)}`;
}

export type DialogAttachmentFile = {
  name: string;
  size: number;
  mimeType: string;
  buffer: Buffer;
};

export type SendDialogAttachmentResult =
  | { ok: true; messageId: string }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'not_found'
        | 'too_large'
        | 'invalid_mime'
        | 'channel_no_attachments'
        | 'storage';
    };

/**
 * Сотрудник прикладывает файл к диалогу.
 *
 * Порядок: скоуп → канал вообще принимает файлы → форма и размер файла →
 * хранилище → сообщение со статусом «проверяется» → очередь антивируса.
 * Отправки здесь нет: её сделает процессор после `clean` (см. заголовок).
 */
export async function sendDialogAttachment(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dialogId: string; file: DialogAttachmentFile }
): Promise<SendDialogAttachmentResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const dialog = await prisma.messengerDialog.findUnique({
    where: { id: args.dialogId },
    select: { id: true, channel: true, companyId: true },
  });
  if (!dialog || !isDialogInScope(session, dialog)) return { ok: false, error: 'not_found' };

  const channel = dialog.channel as DialogChannel;
  // Проверяем канал ДО загрузки в хранилище: незачем класть файл, который
  // всё равно нельзя отправить.
  if (!channelAcceptsAttachment(channel)) return { ok: false, error: 'channel_no_attachments' };

  if (args.file.size > attachmentLimitBytes(channel)) return { ok: false, error: 'too_large' };
  if (!ALLOWED_MIME_TYPES.has(args.file.mimeType)) return { ok: false, error: 'invalid_mime' };
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(args.file.mimeType)) {
    const validation = validateMagicBytes(args.file.mimeType, args.file.buffer);
    if (!validation.ok) return { ok: false, error: 'invalid_mime' };
  }

  const path = storageKey(dialog.id, args.file.name);
  try {
    await getObjectStorage().upload(path, args.file.buffer, { contentType: args.file.mimeType });
  } catch (error) {
    log.error('[messengers/attachment] storage upload failed', {
      dialogId: dialog.id,
      storagePath: path,
      providerError: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: 'storage' };
  }

  const message = await prisma.messengerMessage.create({
    data: {
      dialogId: dialog.id,
      direction: 'out',
      body: args.file.name,
      authorId: session.sub,
      // Отправка ещё не состоялась — до проверки файл никуда не уходит.
      deliveryStatus: 'pending',
      attachmentPath: path,
      attachmentName: args.file.name,
      attachmentMime: args.file.mimeType,
      attachmentSize: args.file.size,
      scanStatus: 'pending',
    },
    select: { id: true },
  });

  await prisma.messengerDialog.update({
    where: { id: dialog.id },
    data: {
      lastMessageAt: new Date(),
      lastMessagePreview: previewOf(`Файл: ${args.file.name}`),
      lastMessageDirection: 'out',
      unreadCount: 0,
    },
  });

  // Очередь — best-effort, как у документов: сбой постановки не отменяет
  // загрузку, файл останется `pending` и его добьёт часовой сбор.
  try {
    const payload: ScanDocumentPayload = { kind: 'messenger_attachment', id: message.id };
    await getQueue('docs.scanDocument').add('scan', payload);
  } catch (error) {
    log.warn('[messengers/attachment] scan enqueue failed', {
      messageId: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Файл в НИЧЕЙНОМ диалоге забирает его в компанию отправившего — то же
  // правило первого ответившего (`Р-М-2`), что и у текста. Без этого файл,
  // загруженный компанией А, остался бы в общей очереди, которую видят
  // сотрудники всех компаний, и его скачал бы кто угодно. Условие в `where`:
  // если компанию успел проставить другой, его решение не перетираем.
  if (dialog.companyId === null) {
    const claimed = await prisma.messengerDialog.updateMany({
      where: { id: dialog.id, companyId: null },
      data: { companyId: session.companyId },
    });
    if (claimed.count > 0) {
      await recordAudit(prisma, {
        action: 'messenger_dialog_bound',
        entity: 'messenger_dialog',
        entityId: dialog.id,
        userId: session.sub,
        after: { companyId: session.companyId, reason: 'attachment' },
      });
    }
  }

  await recordAudit(prisma, {
    action: 'messenger_attachment_sent',
    entity: 'messenger_dialog',
    entityId: dialog.id,
    userId: session.sub,
    after: { messageId: message.id, name: args.file.name, size: args.file.size },
  });

  return { ok: true, messageId: message.id };
}

export type DialogAttachmentUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'not_ready' | 'infected' | 'storage' };

/**
 * Ссылка на скачивание вложения — подписанная, на 600 секунд.
 *
 * Гейт проверки зеркалит чат и документы: `infected` — карантин (роут отвечает
 * 410, а не 404: это разные сигналы, CLAUDE.md §10), всё, что не `clean`, —
 * «ещё не проверено» (409), а не отказ навсегда.
 */
export async function getDialogAttachmentUrl(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dialogId: string; messageId: string }
): Promise<DialogAttachmentUrlResult> {
  const message = await prisma.messengerMessage.findUnique({
    where: { id: args.messageId },
    select: {
      id: true,
      dialogId: true,
      attachmentPath: true,
      attachmentName: true,
      scanStatus: true,
      dialog: { select: { id: true, companyId: true } },
    },
  });
  if (!message || !message.attachmentPath) return { ok: false, error: 'not_found' };

  // Сообщение должно принадлежать ИМЕННО тому диалогу, который открыт: иначе
  // чужой `messageId` в адресе своего диалога отдал бы чужой файл.
  if (message.dialogId !== args.dialogId) return { ok: false, error: 'not_found' };
  if (!isDialogInScope(session, message.dialog)) return { ok: false, error: 'forbidden' };

  // Страховка от данных, заведённых мимо этого сервиса.
  if (!message.attachmentPath.startsWith(ATTACHMENT_PREFIX)) {
    return { ok: false, error: 'not_found' };
  }

  if (message.scanStatus === 'infected') return { ok: false, error: 'infected' };
  if (message.scanStatus !== 'clean') return { ok: false, error: 'not_ready' };

  try {
    const url = await getObjectStorage().createSignedUrl(message.attachmentPath, 600, {
      // exactOptionalPropertyTypes: получатель различает «ключа нет» и
      // «ключ = undefined», поэтому спред, а не `?? undefined`.
      ...(message.attachmentName ? { download: message.attachmentName } : {}),
    });
    return { ok: true, url };
  } catch (error) {
    log.error('[messengers/attachment] signed url failed', {
      messageId: message.id,
      providerError: error instanceof Error ? error.message : String(error),
    });
    // 'storage' (502), не 'not_found': строка есть, недоступно хранилище —
    // выдать это за «файла нет» значит увести поддержку по ложному следу.
    return { ok: false, error: 'storage' };
  }
}

/** Входящий файл: то, что вебхук сумел узнать о присланном клиентом файле. */
export type InboundAttachmentSource = {
  /** Прямая ссылка на файл у провайдера (Telegram — после `getFile`). */
  url: string;
  name: string;
  mimeType: string;
  /** Размер, если провайдер его сообщил, — до скачивания. */
  size?: number | null | undefined;
};

export type StoredInboundAttachment = {
  path: string;
  name: string;
  mimeType: string;
  size: number;
};

/** Предел скачивания входящего: тот же общий, что и у исходящих файлов. */
const INBOUND_FETCH_TIMEOUT_MS = 30_000;

/**
 * Скачать файл клиента у провайдера и положить в хранилище (`У-204`).
 *
 * Возвращает `null`, если файл скачать не удалось или он не проходит проверки:
 * сообщение всё равно будет записано — текстом с именем файла. Терять входящее
 * сообщение из-за неудачной загрузки картинки нельзя.
 *
 * Размер проверяется ДВАЖДЫ: по заявленному провайдером (если он его прислал)
 * и по фактически скачанному. Заявленному размеру верить нельзя — он приходит
 * из внешней системы.
 */
export async function fetchInboundAttachment(
  dialogId: string,
  source: InboundAttachmentSource,
  deps: { fetchImpl?: typeof fetch } = {}
): Promise<StoredInboundAttachment | null> {
  const limit = maxFileSizeBytes();
  if (source.size != null && source.size > limit) {
    log.warn('[messengers/attachment] inbound file too large (declared)', {
      dialogId,
      size: source.size,
    });
    return null;
  }
  if (!ALLOWED_MIME_TYPES.has(source.mimeType)) {
    log.warn('[messengers/attachment] inbound mime not allowed', {
      dialogId,
      mimeType: source.mimeType,
    });
    return null;
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INBOUND_FETCH_TIMEOUT_MS);
  let buffer: Buffer;
  try {
    const res = await doFetch(source.url, { signal: controller.signal });
    if (!res.ok) return null;
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    log.warn('[messengers/attachment] inbound download failed', {
      dialogId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (buffer.byteLength > limit) {
    log.warn('[messengers/attachment] inbound file too large (actual)', {
      dialogId,
      size: buffer.byteLength,
    });
    return null;
  }

  const path = storageKey(dialogId, source.name);
  try {
    await getObjectStorage().upload(path, buffer, { contentType: source.mimeType });
  } catch (error) {
    log.error('[messengers/attachment] inbound storage upload failed', {
      dialogId,
      storagePath: path,
      providerError: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  return {
    path,
    name: source.name,
    mimeType: source.mimeType,
    size: buffer.byteLength,
  };
}

export type DeliverScannedResult =
  { delivered: boolean; reason?: string } | { delivered: false; reason: 'skipped' };

/**
 * Отправить проверенный файл клиенту (`У-204`, ворота «только после `clean`»).
 *
 * Зовётся антивирусным процессором, когда проверка закончилась. Здесь же
 * решается судьба заражённого: он не уходит никуда, сообщение остаётся в
 * истории с пометкой — сотрудник видит, что именно он пытался отправить.
 *
 * Идемпотентно: берётся только сообщение в состоянии `pending`, поэтому
 * повтор задачи не отправит файл клиенту дважды.
 */
export async function deliverScannedAttachment(
  prisma: PrismaClient,
  messageId: string
): Promise<DeliverScannedResult> {
  const message = await prisma.messengerMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      direction: true,
      deliveryStatus: true,
      scanStatus: true,
      attachmentPath: true,
      attachmentName: true,
      attachmentMime: true,
      dialog: { select: { id: true, channel: true, peerRef: true } },
    },
  });

  // Входящие файлы клиенту не пересылаются, повторная доставка исключена.
  if (!message || message.direction !== 'out' || message.deliveryStatus !== 'pending') {
    return { delivered: false, reason: 'skipped' };
  }

  if (message.scanStatus !== 'clean') {
    // Заражённый или непроверенный файл клиенту не уходит НИКОГДА.
    await prisma.messengerMessage.update({
      where: { id: message.id },
      data: { deliveryStatus: 'failed' },
    });
    return { delivered: false, reason: message.scanStatus };
  }

  if (!message.attachmentPath) {
    // Файла нет, а статус «ждёт отправки» — тупик: лента показывала бы вечное
    // «проверяется». Через процессор недостижимо, но прямой вызов возможен.
    await prisma.messengerMessage.update({
      where: { id: message.id },
      data: { deliveryStatus: 'failed' },
    });
    return { delivered: false, reason: 'no_file' };
  }

  // ЗАХВАТ отправки одной записью (приём из `send.ts`). Между чтением строки
  // выше и записью результата ниже есть окно: две задачи очереди на одно
  // сообщение (повтор BullMQ, ручной перезапуск) обе увидели бы `pending` и
  // обе отправили бы файл — клиент получил бы его ДВАЖДЫ. Условие в `where`
  // делает захват атомарным: продолжает только тот, кто перевёл строку из
  // `pending`.
  const claimed = await prisma.messengerMessage.updateMany({
    where: { id: message.id, deliveryStatus: 'pending' },
    data: { deliveryStatus: 'sending' },
  });
  if (claimed.count === 0) return { delivered: false, reason: 'skipped' };

  let buffer: Buffer;
  try {
    buffer = await getObjectStorage().download(message.attachmentPath);
  } catch (error) {
    log.error('[messengers/attachment] download before send failed', {
      messageId: message.id,
      providerError: error instanceof Error ? error.message : String(error),
    });
    await prisma.messengerMessage.update({
      where: { id: message.id },
      data: { deliveryStatus: 'failed' },
    });
    return { delivered: false, reason: 'storage' };
  }

  const sent = await sendAttachmentToMessenger(
    message.dialog.channel as MessengerChannel,
    message.dialog.peerRef,
    {
      name: message.attachmentName ?? 'file',
      mimeType: message.attachmentMime ?? 'application/octet-stream',
      buffer,
    }
  );

  await prisma.messengerMessage.update({
    where: { id: message.id },
    data: { deliveryStatus: sent.ok ? 'sent' : 'failed' },
  });
  return { delivered: sent.ok, ...(sent.ok ? {} : { reason: 'transport' }) };
}
