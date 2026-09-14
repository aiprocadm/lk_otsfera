import { prisma } from '@/lib/db/prisma';
import { getSettingValue } from '@/lib/config/integrationSettings';
import { send } from '@/lib/email/send';
import { log } from '@/lib/logging';

/**
 * Ответ менеджера на письмо клиента (`У-205`, спека этапа 3 §3.4).
 *
 * До этапа 3 ответить на письмо было нельзя вовсе: `replyToInbound` для
 * канала `email` возвращал отказ с кодом `email_unsupported`. Менеджер видел
 * письмо во «Входящих», а отвечал из своей почты — и этот ответ не попадал
 * ни в кабинет, ни в историю клиента.
 *
 * Три вещи, без которых ответ «не считается ответом»:
 *
 * 1. **`Reply-To`** — адрес входящего ящика (`imap.user`). Письма кабинета
 *    уходят с `no-reply`, и без этой замены ответ клиента улетел бы в никуда,
 *    а переписка оборвалась бы на середине.
 * 2. **`In-Reply-To`** — идентификатор письма, на которое отвечаем. Без него
 *    почтовая программа клиента покажет ответ отдельным письмом, а не в той
 *    же ветке.
 * 3. **`Re:` в теме** — то же самое, но для человека.
 */

/**
 * Похоже ли значение на почтовый адрес. У почтовых серверов логин часто НЕ
 * адрес (`support`, `otsfera\\support`) — такой `Reply-To` получатель
 * отбросит, и ответ клиента снова уйдёт в никуда. Проверка намеренно грубая:
 * нам нужно отличить «адрес» от «логина», а не валидировать RFC.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value.trim());
}

/** Тема ответа: «Re:» добавляется один раз, повторов не плодим. */
export function replySubject(subject: string | null | undefined): string {
  const base = subject?.trim();
  if (!base) return 'Re: ваше обращение';
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

/** Простая разметка письма: текст менеджера с сохранением переносов строк. */
function htmlOf(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<!DOCTYPE html>\n<html><body><div style="white-space:pre-wrap">${escaped}</div></body></html>`;
}

export type SendEmailReplyArgs = {
  to: string;
  subject: string | null | undefined;
  text: string;
  /** `Message-ID` письма клиента — сшивка ветки; null, если он неизвестен. */
  inReplyTo: string | null | undefined;
};

/**
 * Отправка ответа. Контракт тот же, что у остальных веток `replyToInbound`:
 * `{ ok }` без исключений — вызывающий отличает удачу от неудачи, но не
 * падает из-за почты.
 */
export async function sendEmailReply(args: SendEmailReplyArgs): Promise<{ ok: boolean }> {
  if (!args.to.trim()) return { ok: false };

  try {
    // Ящик, который читает IMAP-приём. Без него отвечать НЕЛЬЗЯ: письмо уйдёт
    // с `no-reply`, ответ клиента попадёт в несуществующий ящик, а кабинет
    // отчитается «отправлено» — переписка оборвётся ровно там, где `У-205`
    // обещал двусторонность, и никто об этом не узнает. Лучше честный отказ:
    // сотрудник увидит, что ответ не ушёл, и напишет из почты.
    const inbox = (await getSettingValue(prisma, 'imap.user'))?.trim() || '';
    if (!looksLikeEmail(inbox)) {
      log.warn('[inbound/emailReply] входящий ящик не настроен адресом — ответ не отправлен', {
        configured: inbox.length > 0,
      });
      return { ok: false };
    }

    const result = await send({
      to: args.to,
      subject: replySubject(args.subject),
      html: htmlOf(args.text),
      text: args.text,
      replyTo: inbox,
      ...(args.inReplyTo
        ? { headers: { inReplyTo: args.inReplyTo, references: [args.inReplyTo] } }
        : {}),
    });
    // Успех — только `sent`. `skipped` (почта выключена, нет ключа) и `failed`
    // (провайдер отказал) — это НЕ отправка: иначе история диалога показала бы
    // ответ, которого клиент не получил.
    return { ok: result.status === 'sent' };
  } catch (error) {
    // Чтение настройки тоже внутри `try`: контракт «`{ ok }` без исключений»
    // должен держаться и когда база недоступна.
    log.warn('[inbound/emailReply] send failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }
}
