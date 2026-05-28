import type { PrismaClient, Prisma, Role } from '@prisma/client';

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
  if (filters.q) {
    where.OR = [
      { email: { contains: filters.q, mode: 'insensitive' } },
      { name: { contains: filters.q, mode: 'insensitive' } }
    ];
  }
  if (filters.partnerId) where.partnerId = filters.partnerId;
  if (filters.organizationId) {
    where.OR = [
      ...(where.OR ?? []),
      { organizationUsers: { some: { organizationId: filters.organizationId } } },
      { managedOrganizations: { some: { organizationId: filters.organizationId } } }
    ];
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
