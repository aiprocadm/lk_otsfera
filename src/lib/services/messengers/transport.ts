import { sendTelegramDocument, sendTelegramMessage } from '@/lib/telegram/client';
import { sendMaxMessage } from '@/lib/max/client';
import { sendWhatsAppMessage } from '@/lib/whatsapp/aggregator';
import type { MessengerChannel } from './channels';

/**
 * Единый исходящий транспорт мессенджеров (Р-М-7): роутит канал в уже
 * существующие клиенты — те же, которыми уходят уведомления. Сетевого кода
 * здесь нет и быть не должно; вся сеть — за адаптерами `lib/{telegram,max,
 * whatsapp}`, в тестах они мокаются.
 *
 * Best-effort: клиенты сами возвращают `{ ok: false }` вместо исключений, но
 * контракт закреплён и здесь — вызывающий всегда получает `{ ok }`, даже если
 * адаптер (или его мок) отвечает не тем, чем обещал.
 */
export async function sendToMessenger(
  channel: MessengerChannel,
  peerRef: string,
  text: string
): Promise<{ ok: boolean }> {
  try {
    const result = await sendByChannel(channel, peerRef, text);
    return { ok: !!(result as { ok?: boolean } | undefined)?.ok };
  } catch {
    // Адаптер не бросает по контракту; страховка на случай чужого мока или
    // будущего адаптера — отправка «не удалась», история диалога это покажет.
    return { ok: false };
  }
}

function sendByChannel(
  channel: MessengerChannel,
  peerRef: string,
  text: string
): Promise<{ ok: boolean }> {
  switch (channel) {
    case 'telegram':
      return sendTelegramMessage(peerRef, text);
    case 'max':
      return sendMaxMessage(peerRef, text);
    case 'whatsapp':
      return sendWhatsAppMessage(peerRef, text);
  }
}

/**
 * Каналы, в которые можно отправить файл (`У-204`).
 *
 * Только Telegram. Это не забывчивость, а отказ выдумывать чужой контракт:
 * у MAX и у агрегатора WhatsApp форма загрузки файла в их API не подтверждена
 * документацией, которая была на руках. Отправить «наугад» хуже, чем честно
 * отказать: запрос ушёл бы в никуда, а в истории диалога осталась бы запись
 * «отправлено» — ровно тот случай, когда система врёт человеку.
 *
 * Когда контракт подтвердится, канал добавляется сюда и в `sendAttachment`.
 * Вопрос заказчику — `В-3-10` спеки этапа.
 */
const ATTACHMENT_CHANNELS = ['telegram'] as const;

export function channelAcceptsAttachment(channel: MessengerChannel): boolean {
  return (ATTACHMENT_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Отправка файла в канал. Контракт тот же, что у текста: `{ ok }` без
 * исключений. Канал, который файлы не принимает, отвечает `unsupported` —
 * вызывающий покажет человеку причину, а не «не доставлено».
 */
export async function sendAttachmentToMessenger(
  channel: MessengerChannel,
  peerRef: string,
  file: { name: string; mimeType: string; buffer: Buffer },
  caption?: string
): Promise<{ ok: boolean; unsupported?: true }> {
  if (!channelAcceptsAttachment(channel)) return { ok: false, unsupported: true };
  try {
    const result = await sendTelegramDocument(peerRef, file, caption);
    return { ok: !!(result as { ok?: boolean } | undefined)?.ok };
  } catch {
    return { ok: false };
  }
}
