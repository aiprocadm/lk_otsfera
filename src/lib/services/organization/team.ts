import type { PrismaClient, Prisma } from '@prisma/client';
import type { OrgRoleInOrg } from '@/lib/auth/jwt';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { recordAudit } from '@/lib/auth/audit';
import { MAX_ORGANIZATION_USERS } from '@/lib/config/teamLimits';

export type OrgMemberErrorCode =
  | 'already_member'
  | 'last_admin_protected'
  | 'self_action_forbidden'
  | 'requires_admin'
  | 'member_limit_reached'
  | 'not_found';

export class OrgMemberError extends Error {
  readonly code: OrgMemberErrorCode;
  constructor(code: OrgMemberErrorCode) {
    super(code);
    this.code = code;
    this.name = 'OrgMemberError';
  }
}

export type OrgMemberRow = {
  organizationUserId: string;
  userId: string;
  email: string;
  name: string;
  roleInOrg: 'admin' | 'leader' | 'member';
  isActive: boolean;
  invitedAt: Date;
  lastLoginAt: Date | null;
  /** ФТ-10.2: true = пароль ещё не установлен — можно переотправить приглашение. */
  invitePending: boolean;
};

export type InviteMemberInput = {
  organizationId: string;
  email: string;
  name: string;
  roleInOrg: 'admin' | 'leader' | 'member';
};

export type InviteMemberResult = {
  user: { id: string; email: string };
  inviteUrl: string | null;
  alreadyHasPassword: boolean;
};

function normaliseRole(value: string | null | undefined): 'admin' | 'leader' | 'member' {
  if (value === 'admin') return 'admin';
  if (value === 'leader') return 'leader';
  return 'member';
}

function getAppBaseUrl(): string {
  return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
}

/** §14 ТЗ: не более MAX_ORGANIZATION_USERS активных контактных лиц на организацию. */
async function assertOrgUserLimit(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<void> {
  const activeCount = await tx.organizationUser.count({
    where: { organizationId, isActive: true },
  });
  if (activeCount >= MAX_ORGANIZATION_USERS) {
    throw new OrgMemberError('member_limit_reached');
  }
}

export async function listMembers(
  prisma: PrismaClient,
  organizationId: string
): Promise<OrgMemberRow[]> {
  const rows = await prisma.organizationUser.findMany({
    where: { organizationId },
    // Этап 10 (§7 ТЗ): явный select. `passwordHash` — только ради признака
    // `invitePending`, наружу не уходит (guardrail на клиентские DTO).
    select: {
      id: true,
      userId: true,
      roleInOrg: true,
      isActive: true,
      createdAt: true,
      user: {
        select: { id: true, email: true, name: true, passwordHash: true, lastLoginAt: true },
      },
    },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });

  return rows.map((r) => ({
    organizationUserId: r.id,
    userId: r.userId,
    email: r.user.email,
    name: r.user.name,
    roleInOrg: normaliseRole(r.roleInOrg),
    isActive: r.isActive,
    invitedAt: r.createdAt,
    // ФТ-11.3: до этапа 9 здесь стояла заглушка null — теперь реальная отметка.
    lastLoginAt: r.user.lastLoginAt ?? null,
    invitePending: r.user.passwordHash === null,
  }));
}

export type InviteMemberAuditMeta = {
  /** Logged into audit.after.source so partner vs platform-admin invites are traceable. */
  source?: 'partner' | 'platform_admin' | 'organization';
};

export async function inviteMember(
  prisma: PrismaClient,
  args: InviteMemberInput,
  actorUserId: string,
  audit: InviteMemberAuditMeta = {},
  actorRole: OrgRoleInOrg = 'admin' // back-compat default; callers must pass real actor role
): Promise<({ ok: true } & InviteMemberResult) | { ok: false; error: OrgMemberErrorCode }> {
  try {
    if (actorRole === 'leader' && args.roleInOrg === 'admin') {
      throw new OrgMemberError('requires_admin');
    }
    const result = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: args.email } });
      let isNewUser = false;
      if (!user) {
        user = await tx.user.create({
          data: {
            email: args.email,
            name: args.name,
            role: 'organization',
            isActive: true,
            passwordHash: null,
          },
        });
        isNewUser = true;
      }

      const existing = await tx.organizationUser.findUnique({
        where: {
          organizationId_userId: {
            organizationId: args.organizationId,
            userId: user.id,
          },
        },
      });

      let orgUserId: string;
      let reactivated = false;
      if (existing) {
        if (existing.isActive) {
          throw new OrgMemberError('already_member');
        }
        // A leader must not reactivate/alter an existing admin membership — the
        // pre-transaction guard only blocks granting admin to a NEW invite; this
        // closes the reactivation path (re-inviting a deactivated admin).
        if (actorRole === 'leader' && normaliseRole(existing.roleInOrg) === 'admin') {
          throw new OrgMemberError('requires_admin');
        }
        // Reactivation adds an active member — enforce the cap (deactivated rows are free).
        await assertOrgUserLimit(tx, args.organizationId);
        const updated = await tx.organizationUser.update({
          where: { id: existing.id },
          data: { isActive: true, roleInOrg: args.roleInOrg },
        });
        orgUserId = updated.id;
        reactivated = true;
      } else {
        await assertOrgUserLimit(tx, args.organizationId);
        const created = await tx.organizationUser.create({
          data: {
            organizationId: args.organizationId,
            userId: user.id,
            roleInOrg: args.roleInOrg,
            isActive: true,
          },
        });
        orgUserId = created.id;
      }

      let inviteUrl: string | null = null;
      let alreadyHasPassword = false;
      if (user.passwordHash === null) {
        const { token } = await createInviteToken(tx, user.id);
        inviteUrl = `${getAppBaseUrl()}/reset-password?token=${token}`;
      } else {
        alreadyHasPassword = true;
      }

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'org_member_invited',
        entity: 'organization_user',
        entityId: orgUserId,
        after: {
          organizationId: args.organizationId,
          userId: user.id,
          email: args.email,
          roleInOrg: args.roleInOrg,
          isNewUser,
          reactivated,
          alreadyHasPassword,
          ...(audit.source ? { source: audit.source } : {}),
        },
      });

      return {
        user: { id: user.id, email: user.email },
        inviteUrl,
        alreadyHasPassword,
      };
    });
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof OrgMemberError) return { ok: false, error: e.code };
    throw e;
  }
}

async function loadOrgUserOrThrow(
  tx: Prisma.TransactionClient,
  organizationId: string,
  orgUserId: string
) {
  const row = await tx.organizationUser.findUnique({ where: { id: orgUserId } });
  // Cross-tenant guard: the membership must belong to the organization the
  // caller was authorised for. Without this, an admin of org A could mutate
  // members of org B by passing a foreign orgUserId — the server action only
  // verifies admin-ship of the *claimed* org, not that the target lives in it.
  if (!row || row.organizationId !== organizationId) throw new OrgMemberError('not_found');
  return row;
}

async function assertNotLastActiveAdmin(
  tx: Prisma.TransactionClient,
  organizationId: string,
  candidateOrgUserId: string
): Promise<void> {
  const activeAdmins = await tx.organizationUser.count({
    where: {
      organizationId,
      roleInOrg: 'admin',
      isActive: true,
      NOT: { id: candidateOrgUserId },
    },
  });
  if (activeAdmins === 0) {
    throw new OrgMemberError('last_admin_protected');
  }
}

export async function updateMemberRole(
  prisma: PrismaClient,
  organizationId: string,
  orgUserId: string,
  newRole: 'admin' | 'leader' | 'member',
  actorUserId: string,
  actorRole: OrgRoleInOrg = 'admin' // back-compat default; callers must pass real actor role
): Promise<{ ok: true } | { ok: false; error: OrgMemberErrorCode }> {
  try {
    await prisma.$transaction(async (tx) => {
      const target = await loadOrgUserOrThrow(tx, organizationId, orgUserId);
      if (target.userId === actorUserId) {
        throw new OrgMemberError('self_action_forbidden');
      }
      const currentRole = normaliseRole(target.roleInOrg);
      if (actorRole === 'leader' && (currentRole === 'admin' || newRole === 'admin')) {
        throw new OrgMemberError('requires_admin');
      }
      // Guard above must run before this no-op: a leader touching an admin row
      // must fail even when newRole === currentRole.
      if (currentRole === newRole) return; // no-op

      if (currentRole === 'admin' && newRole === 'member' && target.isActive) {
        await assertNotLastActiveAdmin(tx, target.organizationId, target.id);
      }

      await tx.organizationUser.update({
        where: { id: target.id },
        data: { roleInOrg: newRole },
      });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'org_member_role_changed',
        entity: 'organization_user',
        entityId: target.id,
        before: { roleInOrg: currentRole },
        after: { roleInOrg: newRole },
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof OrgMemberError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function deactivateMember(
  prisma: PrismaClient,
  organizationId: string,
  orgUserId: string,
  actorUserId: string,
  actorRole: OrgRoleInOrg = 'admin' // back-compat default; callers must pass real actor role
): Promise<{ ok: true } | { ok: false; error: OrgMemberErrorCode }> {
  try {
    await prisma.$transaction(async (tx) => {
      const target = await loadOrgUserOrThrow(tx, organizationId, orgUserId);
      if (target.userId === actorUserId) {
        throw new OrgMemberError('self_action_forbidden');
      }
      if (actorRole === 'leader' && normaliseRole(target.roleInOrg) === 'admin') {
        throw new OrgMemberError('requires_admin');
      }
      if (!target.isActive) return; // no-op

      if (normaliseRole(target.roleInOrg) === 'admin') {
        await assertNotLastActiveAdmin(tx, target.organizationId, target.id);
      }

      await tx.organizationUser.update({
        where: { id: target.id },
        data: { isActive: false },
      });

      // Этап 9 (ФТ-11.2): гашения membership мало — клеймы организации сидят в
      // 7-дневном токене, поэтому отзываем и сессии участника.
      await tx.user.update({
        where: { id: target.userId },
        data: { sessionVersion: { increment: 1 } },
      });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'org_member_deactivated',
        entity: 'organization_user',
        entityId: target.id,
        before: { isActive: true },
        after: { isActive: false },
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof OrgMemberError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function reactivateMember(
  prisma: PrismaClient,
  organizationId: string,
  orgUserId: string,
  actorUserId: string,
  actorRole: OrgRoleInOrg = 'admin' // back-compat default; callers must pass real actor role
): Promise<{ ok: true } | { ok: false; error: OrgMemberErrorCode }> {
  try {
    await prisma.$transaction(async (tx) => {
      const target = await loadOrgUserOrThrow(tx, organizationId, orgUserId);
      if (target.userId === actorUserId) {
        throw new OrgMemberError('self_action_forbidden');
      }
      if (actorRole === 'leader' && normaliseRole(target.roleInOrg) === 'admin') {
        throw new OrgMemberError('requires_admin');
      }
      if (target.isActive) return; // no-op

      await tx.organizationUser.update({
        where: { id: target.id },
        data: { isActive: true },
      });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'org_member_reactivated',
        entity: 'organization_user',
        entityId: target.id,
        before: { isActive: false },
        after: { isActive: true },
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof OrgMemberError) return { ok: false, error: e.code };
    throw e;
  }
}
