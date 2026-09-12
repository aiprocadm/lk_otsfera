import { sendTelegramMessage } from '@/lib/telegram/client';
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
