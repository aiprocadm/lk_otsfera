import type { PrismaClient, Prisma, Role } from '@prisma/client';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { recordAudit } from '@/lib/auth/audit';

export type AdminUserErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'admin_role_via_ui'
  | 'self_action_forbidden'
  | 'last_admin_protected'
  | 'duplicate_email'
  | 'role_transition_forbidden';

export class AdminUserError extends Error {
  readonly code: AdminUserErrorCode;
  constructor(code: AdminUserErrorCode) {
    super(code);
    this.code = code;
    this.name = 'AdminUserError';
  }
}

export type AdminUserFailure = { ok: false; error: AdminUserErrorCode };

export type UserDetail = UserRow & {
  partnerId: string | null;
  organizationMemberships: Array<{
    organizationUserId: string;
    organizationId: string;
    organizationName: string;
    roleInOrg: string;
    isActive: boolean;
  }>;
  organizationManagerships: Array<{
    organizationManagerId: string;
    organizationId: string;
    organizationName: string;
    isActive: boolean;
  }>;
};

export async function getUser(
  prisma: PrismaClient,
  id: string
): Promise<UserDetail | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    include: {
      partner: { select: { name: true } },
      organizationUsers: {
        include: { organization: { select: { id: true, name: true } } }
      },
      managedOrganizations: {
        include: { organization: { select: { id: true, name: true } } }
      }
    }
  });
  if (!u) return null;

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
    attachmentLabel: computeAttachmentLabel(u),
    partnerId: u.partnerId,
    organizationMemberships: u.organizationUsers.map((ou) => ({
      organizationUserId: ou.id,
      organizationId: ou.organizationId,
      organizationName: ou.organization.name,
      roleInOrg: ou.roleInOrg ?? '',
      isActive: ou.isActive
    })),
    organizationManagerships: u.managedOrganizations.map((om) => ({
      organizationManagerId: om.id,
      organizationId: om.organizationId,
      organizationName: om.organization.name,
      isActive: om.isActive
    }))
  };
}

export type CreateUserArgs = {
  email: string;
  name: string;
  role: Exclude<Role, 'admin'>;
  partnerId?: string | null;
};

export type CreateUserResult = {
  user: { id: string; email: string; name: string; role: Role };
  inviteToken: string;
};

export async function createUser(
  prisma: PrismaClient,
  actorUserId: string,
  args: CreateUserArgs
): Promise<({ ok: true } & CreateUserResult) | AdminUserFailure> {
  try {
    if (args.role === ('admin' as Role)) {
      throw new AdminUserError('admin_role_via_ui');
    }
    if (args.role === 'partner' && !args.partnerId) {
      throw new AdminUserError('not_found');
    }

    const data = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: args.email } });
      if (existing) throw new AdminUserError('duplicate_email');

      const user = await tx.user.create({
        data: {
          email: args.email,
          name: args.name,
          role: args.role,
          partnerId: args.partnerId ?? null,
          passwordHash: null,
          isActive: true
        }
      });

      if (args.role === 'partner' && args.partnerId) {
        await tx.partnerUser.create({
          data: {
            userId: user.id,
            partnerId: args.partnerId,
            roleInPartner: 'member',
            assignedOrgIds: []
          }
        });
      }

      const { token } = await createInviteToken(tx, user.id);

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'user_created',
        entity: 'user',
        entityId: user.id,
        after: {
          email: args.email,
          role: args.role,
          partnerId: args.partnerId ?? null
        }
      });

      return {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        inviteToken: token
      };
    });
    return { ok: true, ...data };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}

async function assertNotLastActiveAdmin(
  tx: Prisma.TransactionClient,
  candidateUserId: string
): Promise<void> {
  const remaining = await tx.user.count({
    where: { role: 'admin', isActive: true, NOT: { id: candidateUserId } }
  });
  if (remaining === 0) {
    throw new AdminUserError('last_admin_protected');
  }
}

export type UpdateUserArgs = {
  name?: string;
  role?: Exclude<Role, 'admin'>;
  partnerId?: string | null;
  isActive?: boolean;
};

const ALLOWED_TRANSITIONS: ReadonlyArray<[Role, Role]> = [
  ['partner', 'partner'],
  ['partner', 'student'],
  ['student', 'partner']
];

function isAllowedRoleTransition(from: Role, to: Role): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export async function updateUser(
  prisma: PrismaClient,
  actorUserId: string,
  id: string,
  args: UpdateUserArgs
): Promise<{ ok: true; user: UserDetail } | AdminUserFailure> {
  try {
    if (id === actorUserId && (args.role !== undefined || args.isActive === false)) {
      throw new AdminUserError('self_action_forbidden');
    }
    if (args.role === ('admin' as Role)) {
      throw new AdminUserError('admin_role_via_ui');
    }

    const updatedDetail = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, isActive: true, partnerId: true, name: true }
      });
      if (!before) throw new AdminUserError('not_found');

      // Role transition gates
      if (args.role && args.role !== before.role) {
        if (!isAllowedRoleTransition(before.role, args.role)) {
          throw new AdminUserError('role_transition_forbidden');
        }
      }

      // Last-admin protection
      if (before.role === 'admin' && (args.role !== undefined || args.isActive === false)) {
        await assertNotLastActiveAdmin(tx, id);
      }

      // Partner cleanup if changing away from partner
      if (before.role === 'partner' && args.role && args.role !== 'partner') {
        await tx.partnerUser.deleteMany({ where: { userId: id } });
      }
      // Partner attach if changing TO partner
      if (args.role === 'partner' && args.partnerId && before.role !== 'partner') {
        await tx.partnerUser.create({
          data: { userId: id, partnerId: args.partnerId, roleInPartner: 'member', assignedOrgIds: [] }
        });
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.role !== undefined ? { role: args.role } : {}),
          ...(args.partnerId !== undefined ? { partnerId: args.partnerId } : {}),
          ...(args.isActive !== undefined ? { isActive: args.isActive } : {})
        }
      });

      const isRoleChange = args.role !== undefined && args.role !== before.role;
      await recordAudit(tx, {
        userId: actorUserId,
        action: isRoleChange ? 'user_role_changed' : 'user_updated',
        entity: 'user',
        entityId: id,
        before: { role: before.role, isActive: before.isActive, partnerId: before.partnerId, name: before.name },
        after: { role: updated.role, isActive: updated.isActive, partnerId: updated.partnerId, name: updated.name }
      });

      const detail = await getUser(tx as unknown as PrismaClient, id);
      return detail!;
    });
    return { ok: true, user: updatedDetail };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function deactivateUser(
  prisma: PrismaClient,
  actorUserId: string,
  id: string
): Promise<{ ok: true } | AdminUserFailure> {
  try {
    if (id === actorUserId) throw new AdminUserError('self_action_forbidden');

    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        select: { role: true, isActive: true }
      });
      if (!before) throw new AdminUserError('not_found');
      if (!before.isActive) return;

      if (before.role === 'admin') {
        await assertNotLastActiveAdmin(tx, id);
      }

      await tx.user.update({ where: { id }, data: { isActive: false } });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'user_deactivated',
        entity: 'user',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false }
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function reactivateUser(
  prisma: PrismaClient,
  actorUserId: string,
  id: string
): Promise<{ ok: true } | AdminUserFailure> {
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        select: { isActive: true }
      });
      if (!before) throw new AdminUserError('not_found');
      if (before.isActive) return;

      await tx.user.update({ where: { id }, data: { isActive: true } });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'user_reactivated',
        entity: 'user',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true }
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}

export type UserFilters = {
  role?: Role;
  active?: boolean;
  q?: string;
  partnerId?: string;
  organizationId?: string;
  take?: number;
  skip?: number;
};

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  attachmentLabel: string;
};

function computeAttachmentLabel(u: {
  role: Role;
  partner: { name: string } | null;
  organizationUsers: Array<{ organization: { name: string } }>;
  managedOrganizations: Array<{ organization: { name: string } }>;
}): string {
  if (u.role === 'partner') return u.partner?.name ?? '—';
  if (u.role === 'organization') {
    const first = u.organizationUsers[0]?.organization.name;
    const extra = u.organizationUsers.length - 1;
    return first ? (extra > 0 ? `${first} (+${extra})` : first) : '—';
  }
  if (u.role === 'manager') {
    const first = u.managedOrganizations[0]?.organization.name;
    const extra = u.managedOrganizations.length - 1;
    return first ? (extra > 0 ? `${first} (+${extra})` : first) : '—';
  }
  return '—';
}

export async function listUsers(
  prisma: PrismaClient,
  filters: UserFilters
): Promise<{ rows: UserRow[]; total: number }> {
  const take = Math.min(Math.max(filters.take ?? 50, 1), 100);
  const skip = Math.max(filters.skip ?? 0, 0);

  const where: Prisma.UserWhereInput = {};
  if (filters.role) where.role = filters.role;
  if (filters.active !== undefined) where.isActive = filters.active;
  if (filters.partnerId) where.partnerId = filters.partnerId;

  const qOrClauses = filters.q
    ? [
        { email: { contains: filters.q, mode: 'insensitive' as const } },
        { name: { contains: filters.q, mode: 'insensitive' as const } }
      ]
    : null;

  const orgOrClauses = filters.organizationId
    ? [
        { organizationUsers: { some: { organizationId: filters.organizationId } } },
        { managedOrganizations: { some: { organizationId: filters.organizationId } } }
      ]
    : null;

  if (qOrClauses && orgOrClauses) {
    where.AND = [{ OR: qOrClauses }, { OR: orgOrClauses }];
  } else if (qOrClauses) {
    where.OR = qOrClauses;
  } else if (orgOrClauses) {
    where.OR = orgOrClauses;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        partner: { select: { name: true } },
        organizationUsers: {
          where: { isActive: true },
          include: { organization: { select: { name: true } } }
        },
        managedOrganizations: {
          where: { isActive: true },
          include: { organization: { select: { name: true } } }
        }
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take,
      skip
    }),
    prisma.user.count({ where })
  ]);

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
    attachmentLabel: computeAttachmentLabel(u)
  }));

  return { rows, total };
}
