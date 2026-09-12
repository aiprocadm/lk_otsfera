import { isTelegramEnabled } from '@/lib/telegram/client';
import { isMaxEnabled } from '@/lib/max/client';
import { isWhatsAppEnabled } from '@/lib/whatsapp/aggregator';

/**
 * Мессенджеры как канал общения с клиентами (спека 2026-09-12).
 *
 * Единственный список каналов-мессенджеров. `InboundMessage.channel` шире —
 * туда же попадают `email` и `cabinet`, но диалог (Р-М-1) заводится только для
 * трёх транспортов, у которых есть исходящая отправка «в тот же адрес».
 * Новый мессенджер = клиент + вебхук + строка здесь (спека §7).
 */
export const MESSENGER_CHANNELS = ['telegram', 'max', 'whatsapp'] as const;

export type MessengerChannel = (typeof MESSENGER_CHANNELS)[number];

/** Как мессенджер называется на экране — одно имя на все кабинеты (§0.2). */
export const MESSENGER_LABELS: Record<MessengerChannel, string> = {
  telegram: 'Telegram',
  max: 'MAX',
  whatsapp: 'WhatsApp',
};

/** Сужение строки канала из `InboundMessage` до мессенджера. */
export function isMessengerChannel(value: string): value is MessengerChannel {
  return (MESSENGER_CHANNELS as readonly string[]).includes(value);
}

/**
 * Канал готов отправлять: ключи заданы, а у MAX и WhatsApp поднят и флаг
 * канала. Ровно те же предикаты, что у транспортов уведомлений — форма ответа
 * в диалоге появляется тогда же, когда канал начинает доставлять уведомления.
 */
export function isMessengerAvailable(channel: MessengerChannel): boolean {
  switch (channel) {
    case 'telegram':
      return isTelegramEnabled();
    case 'max':
      return isMaxEnabled();
    case 'whatsapp':
      return isWhatsAppEnabled();
  }
}
