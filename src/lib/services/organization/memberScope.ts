import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isOrgAdmin, memberOrderScope, type OrgOrderScope } from '@/lib/auth/organizationPolicy';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Настройка «участники видят только свои заказы» (`У-236`, решение `Р-Э6-2`).
 *
 * Хранится на организации, а не на пользователе: это правило компании-клиента,
 * а не личная настройка. Правит её только администратор организации; сама
 * граница видимости живёт в `memberOrderScope` (политика) и применяется в
 * сервисах заказов — скрытая строка в списке была бы внешним видом, а не
 * защитой (§4).
 */
export async function orgOrderScope(
  prisma: PrismaClient,
  session: SessionPayload,
  organizationId: string
): Promise<OrgOrderScope> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { membersSeeOwnOrdersOnly: true },
  });
  // Организации нет — сузить некуда: заказы всё равно фильтруются по ней.
  return memberOrderScope(session, organizationId, org?.membersSeeOwnOrdersOnly ?? false);
}

export async function getOrgMemberScopeSetting(
  prisma: PrismaClient,
  organizationId: string
): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { membersSeeOwnOrdersOnly: true },
  });
  return org?.membersSeeOwnOrdersOnly ?? false;
}

export async function setOrgMemberScope(
  prisma: PrismaClient,
  session: SessionPayload,
  organizationId: string,
  value: boolean
): Promise<{ ok: true } | { ok: false; error: 'forbidden' | 'not_found' }> {
  if (!isOrgAdmin(session, organizationId)) return { ok: false, error: 'forbidden' };
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { membersSeeOwnOrdersOnly: true },
  });
  if (!org) return { ok: false, error: 'not_found' };

  await prisma.organization.update({
    where: { id: organizationId },
    data: { membersSeeOwnOrdersOnly: value },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'organization_member_scope_changed',
    entity: 'organization',
    entityId: organizationId,
    before: { membersSeeOwnOrdersOnly: org.membersSeeOwnOrdersOnly },
    after: { membersSeeOwnOrdersOnly: value },
  });
  return { ok: true };
}
