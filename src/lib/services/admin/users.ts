import type { PrismaClient, Prisma, Role } from '@prisma/client';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { recordAudit } from '@/lib/auth/audit';

export type AdminUserErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'admin_role_via_ui'
  | 'self_action_forbidden'
  | 'last_admin_protected'
  | 'duplicate_email';

export class AdminUserError extends Error {
  readonly code: AdminUserErrorCode;
  constructor(code: AdminUserErrorCode) {
    super(code);
    this.code = code;
    this.name = 'AdminUserError';
  }
}

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
): Promise<CreateUserResult> {
  if (args.role === ('admin' as Role)) {
    throw new AdminUserError('admin_role_via_ui');
  }
  if (args.role === 'partner' && !args.partnerId) {
    throw new AdminUserError('not_found');
  }

  return prisma.$transaction(async (tx) => {
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
