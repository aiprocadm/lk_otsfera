import type { PrismaClient, Prisma, Role } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  attachmentLabel: string;
  /** ФТ-10.2: true = пароль ещё не установлен — можно переотправить приглашение. */
  invitePending: boolean;
  /** ФТ-11.3: последний успешный вход; null = пользователь ещё ни разу не входил. */
  lastLoginAt: Date | null;
};

export type UserDetail = UserRow & {
  partnerId: string | null;
  managerRole: string | null;
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

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type UserFilters = {
  role?: Role | undefined;
  active?: boolean | undefined;
  q?: string | undefined;
  partnerId?: string | undefined;
  organizationId?: string | undefined;
  take?: number | undefined;
  skip?: number | undefined;
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
  if (u.role === 'manager' || u.role === 'leader') {
    const first = u.managedOrganizations[0]?.organization.name;
    const extra = u.managedOrganizations.length - 1;
    return first ? (extra > 0 ? `${first} (+${extra})` : first) : '—';
  }
  return '—';
}

/**
 * Внутренняя выборка карточки БЕЗ записи в журнал ПДн (§25.7).
 * Использовать ТОЛЬКО для пост-мутационного re-fetch внутри транзакций
 * (updateUser), где нет read-контекста. Любое чтение карточки пользователем
 * идёт через getUser, который журналирует доступ.
 */
export async function fetchUserDetail(
  prisma: PrismaClient,
  id: string
): Promise<UserDetail | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    include: {
      partner: { select: { name: true } },
      organizationUsers: {
        include: { organization: { select: { id: true, name: true } } },
      },
      managedOrganizations: {
        include: { organization: { select: { id: true, name: true } } },
      },
    },
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
    invitePending: u.passwordHash === null,
    lastLoginAt: u.lastLoginAt,
    partnerId: u.partnerId,
    managerRole: u.managerRole ?? null,
    organizationMemberships: u.organizationUsers.map((ou) => ({
      organizationUserId: ou.id,
      organizationId: ou.organizationId,
      organizationName: ou.organization.name,
      roleInOrg: ou.roleInOrg ?? '',
      isActive: ou.isActive,
    })),
    organizationManagerships: u.managedOrganizations.map((om) => ({
      organizationManagerId: om.id,
      organizationId: om.organizationId,
      organizationName: om.organization.name,
      isActive: om.isActive,
    })),
  };
}

export async function getUser(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<UserDetail | null> {
  const u = await fetchUserDetail(prisma, id);
  if (!u) return null;
  await recordPiiAccess(prisma, { session, context: 'admin_user_view', subjectIds: [u.id] });
  return u;
}

export async function listUsers(
  prisma: PrismaClient,
  session: SessionPayload,
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
        { name: { contains: filters.q, mode: 'insensitive' as const } },
      ]
    : null;

  const orgOrClauses = filters.organizationId
    ? [
        { organizationUsers: { some: { organizationId: filters.organizationId } } },
        { managedOrganizations: { some: { organizationId: filters.organizationId } } },
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
          include: { organization: { select: { name: true } } },
        },
        managedOrganizations: {
          where: { isActive: true },
          include: { organization: { select: { name: true } } },
        },
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      take,
      skip,
    }),
    prisma.user.count({ where }),
  ]);

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
    attachmentLabel: computeAttachmentLabel(u),
    invitePending: u.passwordHash === null,
    lastLoginAt: u.lastLoginAt,
  }));

  await recordPiiAccess(prisma, {
    session,
    context: 'admin_users_list',
    subjectIds: rows.map((u) => u.id),
    meta: { hasQuery: filters.q !== undefined },
  });

  return { rows, total };
}

/**
 * Активные менеджеры платформы для фильтра «исполнитель» в админском зеркале
 * (Model A — без company-скоупа; гард `requireAdmin` остаётся на странице).
 */
export async function listActiveManagerOptions(
  prisma: PrismaClient
): Promise<Array<{ id: string; name: string }>> {
  return prisma.user.findMany({
    where: { role: { in: ['manager', 'leader'] }, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 200,
  });
}

/**
 * Кандидаты на назначение менеджера заказу.
 *
 * The candidate pool for per-order assignment is *all* active managers, not
 * just those with an existing assignment to the org — admins routinely need to
 * assign cross-org managers as part of the third visibility branch.
 */
export async function listManagerCandidates(
  prisma: PrismaClient
): Promise<Array<{ id: string; name: string; email: string }>> {
  return prisma.user.findMany({
    where: { role: { in: ['manager', 'leader'] }, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { email: 'asc' },
  });
}
