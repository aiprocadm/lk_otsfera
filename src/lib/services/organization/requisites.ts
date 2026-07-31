import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { validateRequisites, type RequisitesInput, type RequisitesValues } from '@/lib/requisites/validate';

/**
 * Этап 8 (ФТ-9.2, PR-1) — реквизиты организации (самообслуживание).
 * Право записи — только admin|leader активной организации (участник-member
 * читает, но не правит — зеркало orgAdminOrLeaderOnly в навигации).
 * Аудит `requisites_changed` без банковских значений целиком (маскируем счёт).
 */

export type OrgRequisites = RequisitesValues & { name: string };

const REQ_SELECT = {
  name: true,
  legalName: true,
  inn: true,
  kpp: true,
  ogrn: true,
  legalAddress: true,
  bankName: true,
  bankAccount: true,
  corrAccount: true,
  bic: true,
  signerName: true,
  signerPosition: true,
  signerBasis: true
} as const;

function activeMembership(session: SessionPayload, orgId: string): { role: string } | null {
  const m = (session.organizationMemberships ?? []).find((x) => x.isActive && x.organizationId === orgId);
  return m ? { role: m.roleInOrg } : null;
}

export async function getOrgRequisites(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<{ ok: true; requisites: OrgRequisites } | { ok: false; error: 'forbidden' | 'not_found' }> {
  if (session.role !== 'organization' || !activeMembership(session, orgId)) return { ok: false, error: 'forbidden' };
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: REQ_SELECT });
  if (!org) return { ok: false, error: 'not_found' };
  return { ok: true, requisites: org };
}

export async function setOrgRequisites(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string,
  input: RequisitesInput
): Promise<{ ok: true } | { ok: false; error: 'forbidden' | 'not_found' | 'validation'; messages?: string[] }> {
  const membership = session.role === 'organization' ? activeMembership(session, orgId) : null;
  if (!membership || (membership.role !== 'admin' && membership.role !== 'leader')) {
    return { ok: false, error: 'forbidden' };
  }

  const validated = validateRequisites(input);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };
  const v = validated.values;

  const before = await prisma.organization.findUnique({ where: { id: orgId }, select: REQ_SELECT });
  if (!before) return { ok: false, error: 'not_found' };

  try {
    await prisma.organization.update({ where: { id: orgId }, data: v });
  } catch (e) {
    // Organization.inn @unique — дубль превращаем в понятную валидацию.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: 'validation', messages: ['Организация с таким ИНН уже существует'] };
    }
    throw e;
  }
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'requisites_changed',
    entity: 'organization',
    entityId: orgId,
    // Банковские счета в аудит не пишем целиком — только последние 4 цифры.
    after: { inn: v.inn, kpp: v.kpp, ogrn: v.ogrn, bic: v.bic, bankAccountTail: v.bankAccount?.slice(-4) ?? null }
  });
  return { ok: true };
}
