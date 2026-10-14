import * as React from 'react';
import type { PrismaClient } from '@prisma/client';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { send, type SendResult } from '@/lib/email/send';
import {
  PasswordResetTemplate,
  passwordResetSubject,
  passwordResetText,
} from '@/lib/email/templates/password-reset';
import { log } from '@/lib/logging';

/**
 * Запрос ссылки на восстановление пароля — доменная часть роута
 * `POST /api/auth/reset-password/request` (§3: роут остаётся тонким).
 *
 * ВАЖНО (безопасность): функция НИЧЕГО не возвращает и ничем не отличает
 * «пользователь есть» от «пользователя нет». Это и есть защита от перечисления
 * аккаунтов: роут отвечает одинаковым `{ ok: true }` при любом исходе, и
 * возвращать сюда результат нельзя — иначе появится соблазн отразить его в
 * ответе. Rate-limit (per-IP + per-email) остаётся в роуте: это транспортная
 * защита, а не доменная логика.
 */

// Dynamic import keeps react-dom/server out of the static module graph.
async function renderHtml(element: React.ReactElement): Promise<string> {
  const mod = await import('react-dom/server');
  return `<!DOCTYPE html>\n${mod.renderToStaticMarkup(element)}`;
}

/**
 * Письмо со ссылкой на установку пароля — одно для «Забыли пароль» и для
 * ссылки входа, которую выдаёт администратор (`У-272`). Возвращает итог
 * отправки как есть: решать, показывать ли его, — вызывающему.
 */
export async function sendPasswordResetEmail(args: {
  to: string;
  name: string;
  resetUrl: string;
}): Promise<SendResult> {
  const props = { name: args.name, resetUrl: args.resetUrl };
  return send({
    to: args.to,
    subject: passwordResetSubject(),
    html: await renderHtml(React.createElement(PasswordResetTemplate, props)),
    text: passwordResetText(props),
  });
}

export async function sendPasswordResetLink(prisma: PrismaClient, email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (user && user.isActive) {
    const { token } = await createInviteToken(prisma, user.id, undefined, 'reset');
    const baseUrl = process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Best-effort: an email-transport failure must not surface to the caller. A
    // 500 here is only reachable when the user exists + is active, so letting it
    // propagate would leak account existence and break the uniform { ok: true }
    // enumeration guard the route returns.
    try {
      await sendPasswordResetEmail({ to: email, name: user.name, resetUrl });
    } catch (err) {
      log.error('[reset-password/request] email send failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
