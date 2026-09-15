/**
 * Мессенджеры как канал общения с клиентами (спека 2026-09-12).
 *
 * Единственный список каналов-мессенджеров. `InboundMessage.channel` шире —
 * туда же попадают `email` и `cabinet`, но диалог (Р-М-1) заводится только для
 * трёх транспортов, у которых есть исходящая отправка «в тот же адрес».
 * Новый мессенджер = клиент + вебхук + строка здесь (спека §7).
 *
 * Модуль ЧИСТЫЙ — без импортов серверного кода: его читают и клиентские
 * компоненты (подписи каналов). Доступность канала (ключи, флаги) живёт в
 * `availability.ts`, она серверная; смешивать нельзя — см. комментарий там.
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
 * Каналы, для которых заводится ДИАЛОГ (`У-205`, спека этапа 3 §3.1).
 *
 * Шире мессенджеров: с этапа 3 у почты появилась исходящая отправка «в тот же
 * адрес» (`У-205`), и переписка по почте — такой же диалог. С `У-212` сюда же
 * входит **кабинет**: вопрос клиента из личного кабинета — это реплика, у
 * которой есть собеседник и история, просто «транспорт» у неё внутренний
 * (уведомление), а `peerRef` — идентификатор пользователя, а не адрес.
 *
 * `MESSENGER_CHANNELS` при этом не меняется: его читают вебхуки, доступность
 * ботов и отправка файлов — там речь именно о мессенджерах. Разделение этих
 * двух списков и есть защита от «кабинет попал в вебхук».
 */
export const DIALOG_CHANNELS = [...MESSENGER_CHANNELS, 'email', 'cabinet'] as const;

export type DialogChannel = (typeof DIALOG_CHANNELS)[number];

/** Как канал называется на экране — одно имя во всех кабинетах (§0.2). */
export const DIALOG_CHANNEL_LABELS: Record<DialogChannel, string> = {
  ...MESSENGER_LABELS,
  email: 'Почта',
  cabinet: 'Кабинет',
};

export function isDialogChannel(value: string): value is DialogChannel {
  return (DIALOG_CHANNELS as readonly string[]).includes(value);
}
