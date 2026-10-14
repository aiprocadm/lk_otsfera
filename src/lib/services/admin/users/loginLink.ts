import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { createInviteToken } from '@/lib/auth/passwordReset';
import type { SendResult } from '@/lib/email/send';
import { emailOutcome, type EmailOutcome } from '@/lib/email/outcome';
import { log } from '@/lib/logging';
import { sendPasswordResetEmail } from '@/lib/services/auth/passwordResetRequest';

/**
 * Ссылка входа для существующего пользователя (`У-272`, ТЗ 13.10.2026, `Д-54`).
 *
 * Раньше ссылку администратор получал только при первом приглашении. Слушатель,
 * потерявший доступ, мог лишь нажать «Забыли пароль» — а на стенде письма не
 * уходили вовсе, и помочь ему было нечем. Теперь администратор в карточке
 * пользователя создаёт одноразовую ссылку на установку пароля тем же
 * механизмом, что сброс (`reset`, короткий срок), видит, ушло ли письмо, и при
 * необходимости передаёт ссылку сам.
 */

export type LoginEmailKind = 'invite' | 'login_link';

/** Последняя попытка письма со ссылкой входа — показывается в карточке. */
export type LoginEmailAttempt = {
  at: Date;
  kind: LoginEmailKind;
  outcome: EmailOutcome;
};

/** `У-271`: итог письма пишется в журнал пользователя — администратор видит его потом. */
export async function recordLoginEmailAttempt(
  prisma: PrismaClient,
  args: { actorUserId: string; userId: string; kind: LoginEmailKind; outcome: EmailOutcome }
): Promise<void> {
  await recordAudit(prisma, {
    userId: args.actorUserId,
    action: 'login_email_attempt',
    entity: 'user',
    entityId: args.userId,
    after: {
      kind: args.kind,
      status: args.outcome.status,
      ...(args.outcome.status === 'not_sent' ? { reason: args.outcome.reason } : {}),
    },
  });
}

export async function lastLoginEmailAttempt(
  prisma: PrismaClient,
  userId: string
): Promise<LoginEmailAttempt | null> {
  const row = await prisma.auditLog.findFirst({
    where: { entity: 'user', entityId: userId, action: 'login_email_attempt' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, meta: true },
  });
  if (!row) return null;
  const after = ((row.meta ?? {}) as { after?: Record<string, unknown> }).after ?? {};
  const kind: LoginEmailKind = after.kind === 'login_link' ? 'login_link' : 'invite';
  const outcome: EmailOutcome =
    after.status === 'sent'
      ? { status: 'sent' }
      : {
          status: 'not_sent',
          reason: typeof after.reason === 'string' ? after.reason : 'причина не записана',
        };
  return { at: row.createdAt, kind, outcome };
}

/** Отправка с перехватом: письмо — побочный эффект, ссылка важнее. */
export async function trySend(
  send: () => Promise<SendResult>,
  context: string
): Promise<EmailOutcome> {
  try {
    return emailOutcome(await send());
  } catch (err) {
    log.error(`[${context}] email send failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return emailOutcome(null);
  }
}

export type IssueLoginLinkResult =
  | { ok: true; url: string; expiresAt: Date; email: EmailOutcome }
  | { ok: false; error: 'forbidden' | 'not_found' | 'inactive' };

export async function issueLoginLink(
  prisma: PrismaClient,
  session: SessionPayload,
  userId: string,
  appUrl: string
): Promise<IssueLoginLinkResult> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, isActive: true },
  });
  if (!user) return { ok: false, error: 'not_found' };
  // Отключённому ссылка не нужна: войти он всё равно не сможет (`getSession`).
  if (!user.isActive) return { ok: false, error: 'inactive' };

  const { token, expiresAt } = await createInviteToken(prisma, user.id, undefined, 'reset');
  const url = `${appUrl}/reset-password?token=${token}`;
  const email = await trySend(
    () => sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl: url }),
    'admin/login-link'
  );
  await recordLoginEmailAttempt(prisma, {
    actorUserId: session.sub,
    userId: user.id,
    kind: 'login_link',
    outcome: email,
  });
  return { ok: true, url, expiresAt, email };
}
