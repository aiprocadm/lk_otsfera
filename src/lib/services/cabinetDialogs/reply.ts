import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { submitCabinetQuestion } from '@/lib/services/inbound/cabinetQuestion';

/**
 * Сообщение клиента из кабинета (`У-234`, решение `Р-Э6-1`).
 *
 * Писать из кабинета можно **только в диалог кабинета** — он у человека один
 * (`channel = 'cabinet'`, `peerRef = userId`). Поэтому идентификатор диалога
 * сюда не передаётся: отвечать в чужой канал (Telegram, почту) из кабинета
 * нельзя, там свои правила доставки и контракт исходящих файлов.
 *
 * Путь записи тот же, что у кнопки «Задать вопрос»: `submitCabinetQuestion` →
 * `ingestInboundMessage` → `appendInboundToDialog` → уведомление менеджерам.
 * Второй точки записи не заводим: она разошлась бы с первой — у сообщения
 * пропали бы «Входящие в работу», ответственный или SLA.
 */
const REPLY_SUBJECT = 'Сообщение из кабинета';

export type CabinetReplyResult =
  | { ok: true }
  | {
      ok: false;
      error: 'forbidden' | 'validation' | 'too_large' | 'invalid_mime' | 'storage';
      messages?: string[];
    };

export async function replyFromCabinet(
  prisma: PrismaClient,
  session: SessionPayload,
  text: string
): Promise<CabinetReplyResult> {
  const res = await submitCabinetQuestion(prisma, session, {
    subject: REPLY_SUBJECT,
    body: text,
  });
  if (!res.ok) {
    return res.messages
      ? { ok: false, error: res.error, messages: res.messages }
      : { ok: false, error: res.error };
  }
  return { ok: true };
}
