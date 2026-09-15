import { createNotification, deliverNotificationToUser } from '@/lib/notifications/core';
import { log } from '@/lib/logging';

/**
 * Кабинет как канал диалога (`У-212`).
 *
 * Вопрос, заданный клиентом из кабинета, — такая же реплика переписки, как
 * сообщение в мессенджере: у неё есть собеседник (пользователь кабинета),
 * история и ответственный. Разница только в «транспорте»: наружу ничего не
 * уходит, ответ доставляется уведомлением внутрь кабинета — и, если у человека
 * привязан бот, ещё и туда (это делает `deliverNotificationToUser`, у него уже
 * есть все каналы доставки).
 *
 * Поэтому `peerRef` диалога канала `cabinet` — это `userId`, а не адрес:
 * адреса у кабинета нет. Отсюда правило: диалог без известного пользователя
 * ответить нельзя — некому.
 */
export async function deliverToCabinet(
  dialog: { id: string; peerRef: string; userId: string | null },
  text: string
): Promise<{ ok: boolean; error?: string }> {
  // `userId` — основной источник, `peerRef` — тот же идентификатор строкой
  // (ключ диалога). Берём связь, если она есть: её проставляет приём вопроса.
  const userId = dialog.userId ?? dialog.peerRef;
  if (!userId) return { ok: false, error: 'Неизвестно, кому в кабинет отвечать' };

  const title = 'Ответ на ваше обращение';
  try {
    const row = await createNotification({
      userId,
      type: 'inbound_reply',
      title,
      body: text,
    });
    await deliverNotificationToUser({
      userId,
      title,
      body: text,
      type: 'inbound_reply',
      dedupKey: row.id,
    });
    return { ok: true };
  } catch (error) {
    // Best-effort, как и у прочих транспортов (§3): сообщение всё равно
    // попадёт в историю диалога с пометкой «не доставлено», а причина —
    // человеку на экран.
    log.warn('[messengers/cabinet] доставка ответа в кабинет не удалась', {
      dialogId: dialog.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: 'Не удалось положить ответ в кабинет' };
  }
}
