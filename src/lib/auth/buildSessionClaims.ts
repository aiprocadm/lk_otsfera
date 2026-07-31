import type { PrismaClient, User } from '@prisma/client';
import type { OrganizationMembership, SessionPayload } from '@/lib/auth/jwt';
import { toSessionAccessProfile, type SessionAccessProfile } from '@/lib/auth/accessProfile';

export type BuildClaimsResult =
  { ok: true; claims: SessionPayload } | { ok: false; error: 'account_deactivated' };

/**
 * Сборка клеймов сессии из строки User — вынесена из login-роута (staff-2FA,
 * спека 2026-07-11), чтобы 2FA-verify выдавал ТОТ ЖЕ токен, что и
 * однофакторный логин. Любая новая денормализация в токен добавляется здесь
 * (одна точка). Логика перенесена дословно; единственное отличие —
 * деактивированное партнёрское членство возвращает Result вместо Response.
 */
export async function buildSessionClaims(
  prisma: PrismaClient,
  user: User
): Promise<BuildClaimsResult> {
  let partnerRole: 'admin' | 'manager' | undefined;
  let assignedOrgIds: string[] | undefined;

  if (user.role === 'partner' && user.partnerId) {
    const membership = await prisma.partnerUser.findUnique({
      where: { partnerId_userId: { partnerId: user.partnerId, userId: user.id } },
    });

    if (membership) {
      if (!membership.isActive) {
        return { ok: false, error: 'account_deactivated' };
      }
      partnerRole = membership.roleInPartner === 'admin' ? 'admin' : 'manager';
      assignedOrgIds = membership.assignedOrgIds;
    }
  }

  let organizationMemberships: OrganizationMembership[] | undefined;

  if (user.role === 'organization') {
    const memberships = await prisma.organizationUser.findMany({
      where: { userId: user.id, isActive: true },
      select: { organizationId: true, roleInOrg: true, isActive: true },
    });

    organizationMemberships = memberships.map((m) => ({
      organizationId: m.organizationId,
      // Must preserve every role in OrgRoleInOrg — narrowing 'leader' to 'member'
      // here silently disables the leader feature for the whole token lifetime.
      roleInOrg: m.roleInOrg === 'admin' ? 'admin' : m.roleInOrg === 'leader' ? 'leader' : 'member',
      isActive: m.isActive,
    }));
  }

  let managedOrgIds: string[] | undefined;
  let managerRole: 'leader' | null | undefined;
  let accessProfile: SessionAccessProfile | undefined;

  if (user.role === 'manager') {
    // C8 company floor: a manager's scope is bounded by their own company.
    // Without the `organization.companyId === user.companyId` filter, a stale or
    // legacy cross-company OrganizationManager row would widen managedOrgIds
    // beyond the isolation boundary (see CLAUDE.md §4). A manager with no
    // companyId is the deny-null sentinel — resolve zero orgs and skip the query.
    const assigned = user.companyId
      ? await prisma.organizationManager.findMany({
          where: { userId: user.id, isActive: true, organization: { companyId: user.companyId } },
          select: { organizationId: true },
        })
      : [];
    managedOrgIds = assigned.map((a) => a.organizationId);
    // Preserve 'leader' explicitly. Mirrors the org-membership narrowing warning
    // above: collapsing this to null silently kills the leader feature for the
    // whole 7d token lifetime.
    managerRole = user.managerRole === 'leader' ? 'leader' : null;
    // G1: денормализуем кастомный профиль доступа в токен (single indexed lookup,
    // как managedOrgIds). null accessProfileId → профиля нет → legacy-поведение.
    if (user.accessProfileId) {
      const row = await prisma.accessProfile.findUnique({ where: { id: user.accessProfileId } });
      if (row) accessProfile = toSessionAccessProfile(row);
    }
  }

  return {
    ok: true,
    claims: {
      sub: user.id,
      role: user.role,
      companyId: user.companyId,
      partnerId: user.partnerId,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      externalStudentId: user.externalStudentId,
      // Этап 9 (ФТ-11.2): версия сессии на момент выдачи; getSession отвергает
      // токен, если версия пользователя с тех пор выросла.
      sessionVersion: user.sessionVersion,
      ...(partnerRole !== undefined ? { partnerRole } : {}),
      ...(assignedOrgIds !== undefined ? { assignedOrgIds } : {}),
      ...(organizationMemberships !== undefined ? { organizationMemberships } : {}),
      ...(managedOrgIds !== undefined ? { managedOrgIds } : {}),
      ...(managerRole !== undefined ? { managerRole } : {}),
      ...(accessProfile !== undefined ? { accessProfile } : {}),
    },
  };
}
