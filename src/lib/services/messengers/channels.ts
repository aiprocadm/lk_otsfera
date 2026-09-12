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

/** Сужение строки канала из `InboundMessage` до мессенджера. */
export function isMessengerChannel(value: string): value is MessengerChannel {
  return (MESSENGER_CHANNELS as readonly string[]).includes(value);
}
