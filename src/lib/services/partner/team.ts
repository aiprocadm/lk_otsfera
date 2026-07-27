import type { PrismaClient, PartnerUser, User } from '@prisma/client';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { MAX_PARTNER_USERS } from '@/lib/config/teamLimits';

function getAppBaseUrl(): string {
  return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
}

export type TeamRow = {
  userId: string;
  partnerUserId: string;
  email: string;
  name: string;
  roleInPartner: 'admin' | 'manager';
  assignedOrgIds: string[];
  isActive: boolean;
  createdAt: Date;
  /** ФТ-10.2: true = пароль ещё не установлен — можно переотправить приглашение. */
  invitePending: boolean;
  /** ФТ-11.3: последний успешный вход; null = ещё ни разу не входил. */
  lastLoginAt: Date | null;
};

export async function listTeam(
  prisma: PrismaClient,
  partnerId: string
): Promise<TeamRow[]> {
  const rows = await prisma.partnerUser.findMany({
    where: { partnerId },
    // Наружу уходит только признак наличия пароля, не сам hash.
    include: { user: { select: { email: true, name: true, passwordHash: true, lastLoginAt: true } } },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }]
  });

  return rows.map((r) => ({
    userId: r.userId,
    partnerUserId: r.id,
    email: r.user.email,
    name: r.user.name,
    roleInPartner: r.roleInPartner === 'admin' ? 'admin' : 'manager',
    assignedOrgIds: r.assignedOrgIds,
    isActive: r.isActive,
    createdAt: r.createdAt,
    invitePending: r.user.passwordHash === null,
    lastLoginAt: r.user.lastLoginAt ?? null
  }));
}

export type InviteInput = {
  partnerId: string;
  email: string;
  name: string;
  roleInPartner: 'admin' | 'manager';
  assignedOrgIds: string[];
};

export async function inviteMember(
  prisma: PrismaClient,
  input: InviteInput
): Promise<
  | { ok: true; user: User; partnerUser: PartnerUser; inviteUrl: string }
  | { ok: false; error: 'org_out_of_scope' | 'email_taken' | 'member_limit_reached' }
> {
  if (input.assignedOrgIds.length > 0) {
    const inScope = await prisma.organization.count({
      where: { partnerId: input.partnerId, id: { in: input.assignedOrgIds } }
    });
    if (inScope !== input.assignedOrgIds.length) {
      return { ok: false, error: 'org_out_of_scope' };
    }
  }

  // §14 ТЗ: не более MAX_PARTNER_USERS активных пользователей на партнёра.
  // Soft seat-cap: под READ COMMITTED count-then-create допускает редкий +1
  // overshoot при строго одновременных приглашениях. Осознанно принято (не
  // граница безопасности); истинная атомарность потребовала бы Serializable +
  // retry-обработки, чего в проекте нет ни для одного пути.
  const activeCount = await prisma.partnerUser.count({
    where: { partnerId: input.partnerId, isActive: true }
  });
  if (activeCount >= MAX_PARTNER_USERS) {
    return { ok: false, error: 'member_limit_reached' };
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) return { ok: false, error: 'email_taken' };

  // Этап 4 (ФТ-10.1): как и остальные точки приглашения — без пароля +
  // invite-токен на установку пароля (раньше здесь был временный bcrypt-пароль,
  // который никто не узнавал: ни письма, ни ссылки).
  const { user, partnerUser, inviteUrl } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: 'partner',
        partnerId: input.partnerId,
        passwordHash: null
      }
    });

    const partnerUser = await tx.partnerUser.create({
      data: {
        partnerId: input.partnerId,
        userId: user.id,
        roleInPartner: input.roleInPartner,
        assignedOrgIds: input.assignedOrgIds,
        isActive: true
      }
    });

    const { token } = await createInviteToken(tx, user.id);
    return { user, partnerUser, inviteUrl: `${getAppBaseUrl()}/reset-password?token=${token}` };
  });

  return { ok: true, user, partnerUser, inviteUrl };
}

export async function assignOrgs(
  prisma: PrismaClient,
  args: { partnerId: string; userId: string; assignedOrgIds: string[] }
): Promise<{ ok: true; partnerUser: PartnerUser } | { ok: false; error: 'org_out_of_scope' }> {
  if (args.assignedOrgIds.length > 0) {
    const inScope = await prisma.organization.count({
      where: { partnerId: args.partnerId, id: { in: args.assignedOrgIds } }
    });
    if (inScope !== args.assignedOrgIds.length) {
      return { ok: false, error: 'org_out_of_scope' };
    }
  }

  const partnerUser = await prisma.partnerUser.update({
    where: { partnerId_userId: { partnerId: args.partnerId, userId: args.userId } },
    data: { assignedOrgIds: args.assignedOrgIds }
  });
  return { ok: true, partnerUser };
}

export async function deactivateMember(
  prisma: PrismaClient,
  args: { partnerId: string; userId: string }
): Promise<
  | { ok: true; partnerUser: PartnerUser }
  | { ok: false; error: 'not_found' | 'last_admin_protected' }
> {
  const target = await prisma.partnerUser.findUnique({
    where: { partnerId_userId: { partnerId: args.partnerId, userId: args.userId } }
  });
  if (!target) return { ok: false, error: 'not_found' };

  if (target.roleInPartner === 'admin' && target.isActive) {
    const activeAdmins = await prisma.partnerUser.count({
      where: { partnerId: args.partnerId, roleInPartner: 'admin', isActive: true }
    });
    if (activeAdmins <= 1) return { ok: false, error: 'last_admin_protected' };
  }

  const partnerUser = await prisma.partnerUser.update({
    where: { id: target.id },
    data: { isActive: false }
  });
  // Этап 9 (ФТ-11.2): партнёрские клеймы (partnerRole/assignedOrgIds) живут в
  // токене — гасим и сессии, иначе снятый участник работает до истечения JWT.
  await prisma.user.update({
    where: { id: args.userId },
    data: { sessionVersion: { increment: 1 } }
  });
  return { ok: true, partnerUser };
}
