import { sendEmailReply } from '@/lib/services/inbound/emailReply';
import { deliverToCabinet } from './cabinet';
import type { DialogChannel } from './channels';
import { sendToMessenger } from './transport';

export type DialogForSend = {
  id: string;
  peerRef: string;
  userId: string | null;
  messages: {
    inboundMessage: { subject: string | null; externalMessageId: string | null } | null;
  }[];
};

/**
 * Доставка ответа по каналу диалога (`У-205`, `У-212`).
 *
 * **Ветка на канал, а не один транспорт.** Раньше здесь стоял
 * `sendToMessenger(dialog.channel as MessengerChannel, …)`, а его `switch`
 * знает только три мессенджера. С этапа 3 диалог бывает и почтовым: приведение
 * типа проходило молча, `switch` не совпадал ни с одной веткой и возвращал
 * `undefined` — то есть ответ по почте ИЗ КАРТОЧКИ ДИАЛОГА не уходил никуда, а
 * сотрудник видел «не доставлено». Работал только ответ из строки «Входящих»,
 * где ветка почты была написана явно. Дефект `У-205`, найден при разведке
 * PR-7 и починен здесь.
 *
 * Возвращаем не только «получилось», но и причину: её показывают человеку и
 * пишут в историю сообщения (`У-213`).
 */
export async function deliverDialogText(
  dialog: DialogForSend,
  channel: DialogChannel,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  if (channel === 'email') {
    const last = dialog.messages[0]?.inboundMessage ?? null;
    const sent = await sendEmailReply({
      to: dialog.peerRef,
      subject: last?.subject ?? null,
      text,
      inReplyTo: last?.externalMessageId ?? null,
    });
    return sent.ok ? { ok: true } : { ok: false, error: 'Почта не приняла письмо' };
  }

  if (channel === 'cabinet') {
    return deliverToCabinet(dialog, text);
  }

  return sendToMessenger(channel, dialog.peerRef, text);
}
