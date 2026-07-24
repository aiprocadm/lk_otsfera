import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { recordAudit } from '@/lib/auth/audit';
import { isRateLimited } from '@/lib/rateLimit';
import {
  sendAdminUserInviteEmail,
  sendManagerInviteEmail,
  sendOrgInviteEmail,
  sendPartnerInviteEmail
} from '@/lib/email/send';
import { log } from '@/lib/logging';

const RESEND_LIMIT = { windowMs: 60 * 60 * 1000, max: 5 };

function getAppBaseUrl(): string {
  return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
}

export type ResendInviteResult =
  | { ok: true; inviteUrl: string; emailStatus: 'sent' | 'skipped' }
  | { ok: false; error: 'forbidden' | 'not_found' | 'already_active' | 'rate_limited' };

/**
 * Повторная отправка приглашения (этап 4, ФТ-10.2). Общий сервис для всех
 * точек: новый invite-токен, старые невыгоревшие инвайт-токены гасятся
 * (старая ссылка перестаёт работать), письмо по роли приглашённого —
 * best-effort, ссылка возвращается для «Скопировать».
 *
 * Скоупы (§4 CLAUDE.md, defense-in-depth поверх гардов экшенов):
 * admin — любой пользователь без пароля; organization-admin — активные
 * участники своих организаций; partner-admin — активные участники своей
 * команды; manager-leader — менеджеры своей компании.
 */
export async function resendInvite(
  prisma: PrismaClient,
  session: SessionPayload,
  args: {
    userId: string;
    /** false = только пере-выпустить ссылку для «Скопировать» (без письма). */
    sendEmail?: boolean;
  }
): Promise<ResendInviteResult> {
  const target = await prisma.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      passwordHash: true,
      partnerId: true,
      companyId: true
    }
  });
  if (!target || !target.isActive) return { ok: false, error: 'not_found' };

  // Скоуп ДО проверки пароля: иначе actor мог бы по чужому userId зондировать,
  // установлен ли у пользователя пароль (разные коды ответа).
  const scoped = await isInScope(prisma, session, target);
  if (!scoped) return { ok: false, error: 'forbidden' };

  if (target.passwordHash !== null) return { ok: false, error: 'already_active' };

  if (await isRateLimited(`invite-resend:${session.sub}`, RESEND_LIMIT)) {
    return { ok: false, error: 'rate_limited' };
  }

  const inviteUrl = await prisma.$transaction(async (tx) => {
    // ФТ-10.2: старый токен инвалидируется — «пере-отправка» не плодит живые ссылки.
    await tx.passwordResetToken.updateMany({
      where: { userId: target.id, purpose: 'invite', usedAt: null },
      data: { usedAt: new Date() }
    });
    const { token } = await createInviteToken(tx, target.id);
    return `${getAppBaseUrl()}/reset-password?token=${token}`;
  });

  const sendEmail = args.sendEmail !== false;
  const emailStatus = sendEmail
    ? await sendInviteEmailFor(prisma, session, target, inviteUrl)
    : 'skipped';

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'invite_resent',
    entity: 'user',
    entityId: target.id,
    after: { targetRole: target.role, emailRequested: sendEmail, emailStatus }
  });

  return { ok: true, inviteUrl, emailStatus };
}

type TargetUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  partnerId: string | null;
  companyId: string | null;
};

async function isInScope(
  prisma: PrismaClient,
  session: SessionPayload,
  target: TargetUser
): Promise<boolean> {
  if (session.role === 'admin') return true;

  if (session.role === 'organization') {
    const adminOrgIds = (session.organizationMemberships ?? [])
      .filter((m) => m.isActive && (m.roleInOrg === 'admin' || m.roleInOrg === 'leader'))
      .map((m) => m.organizationId);
    if (!adminOrgIds.length || target.role !== 'organization') return false;
    const membership = await prisma.organizationUser.findFirst({
      where: { userId: target.id, isActive: true, organizationId: { in: adminOrgIds } },
      select: { id: true }
    });
    return !!membership;
  }

  if (session.role === 'partner') {
    if (session.partnerRole !== 'admin' || !session.partnerId) return false;
    if (target.role !== 'partner' || target.partnerId !== session.partnerId) return false;
    const member = await prisma.partnerUser.findUnique({
      where: { partnerId_userId: { partnerId: session.partnerId, userId: target.id } },
      select: { isActive: true }
    });
    return !!member?.isActive;
  }

  if (session.role === 'manager' && session.managerRole === 'leader') {
    return target.role === 'manager' && !!session.companyId && target.companyId === session.companyId;
  }

  return false;
}

/** Письмо той же точки, что и первичное приглашение, — по роли приглашённого. */
async function sendInviteEmailFor(
  prisma: PrismaClient,
  session: SessionPayload,
  target: TargetUser,
  inviteUrl: string
): Promise<'sent' | 'skipped'> {
  try {
    const invitedByName = session.name ?? undefined;
    if (target.role === 'partner' && target.partnerId) {
      const [partner, member] = await Promise.all([
        prisma.partner.findUnique({ where: { id: target.partnerId }, select: { name: true } }),
        prisma.partnerUser.findUnique({
          where: { partnerId_userId: { partnerId: target.partnerId, userId: target.id } },
          select: { roleInPartner: true }
        })
      ]);
      const sent = await sendPartnerInviteEmail({
        to: target.email,
        partnerName: partner?.name ?? 'партнёр',
        roleLabel: member?.roleInPartner === 'admin' ? 'администратор' : 'менеджер',
        inviteUrl,
        invitedByName
      });
      return sent.status === 'sent' ? 'sent' : 'skipped';
    }
    if (target.role === 'organization') {
      const membership = await prisma.organizationUser.findFirst({
        where: { userId: target.id, isActive: true },
        select: { organization: { select: { name: true } } },
        orderBy: { createdAt: 'asc' }
      });
      const sent = await sendOrgInviteEmail({
        to: target.email,
        organizationName: membership?.organization.name ?? 'организация',
        inviteUrl,
        invitedByName
      });
      return sent.status === 'sent' ? 'sent' : 'skipped';
    }
    if (target.role === 'manager') {
      const assignment = await prisma.organizationManager.findFirst({
        where: { userId: target.id, isActive: true },
        select: { organization: { select: { name: true } } },
        orderBy: { assignedAt: 'asc' }
      });
      const sent = await sendManagerInviteEmail({
        to: target.email,
        organizationName: assignment?.organization.name ?? 'организация',
        inviteUrl,
        invitedByName
      });
      return sent.status === 'sent' ? 'sent' : 'skipped';
    }
    const templateRole = (['organization', 'partner', 'manager', 'student'] as const).find(
      (r) => r === target.role
    );
    const sent = await sendAdminUserInviteEmail({
      to: target.email,
      inviteUrl,
      name: target.name,
      // Роль вне известных шаблону (admin) — нейтральная подпись «кабинету организации» не
      // годится; берём 'manager' как staff-ближайшую. Практически недостижимо: admin-аккаунты
      // создаются с паролем не через invite-поток.
      role: templateRole ?? 'manager',
      invitedByName
    });
    return sent.status === 'sent' ? 'sent' : 'skipped';
  } catch (e) {
    log.warn('[team/resend] send invite email failed', { userId: target.id, error: e instanceof Error ? e.message : String(e) });
    return 'skipped';
  }
}
