import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import {
  validateRequisites,
  type RequisitesInput,
  type RequisitesValues,
} from '@/lib/requisites/validate';

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
  signerBasis: true,
} as const;

function activeMembership(session: SessionPayload, orgId: string): { role: string } | null {
  const m = (session.organizationMemberships ?? []).find(
    (x) => x.isActive && x.organizationId === orgId
  );
  return m ? { role: m.roleInOrg } : null;
}

/**
 * Этап 4 ТЗ понятности (`У-62`): реквизиты организации ведёт и **партнёр**,
 * в чьём портфеле она состоит.
 *
 * Читать может любой партнёрский пользователь с доступом к организации,
 * **править — только партнёр-администратор**. Проверка живёт здесь, в сервисе,
 * а не в компоненте: скрытая форма — это внешний вид, а не защита (§4).
 *
 * Скоуп проверяется по БД (`Organization.partnerId`), а не по сессии: список
 * организаций в токене может устареть, а привязка к партнёру — не может.
 */
async function partnerAccess(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<{ canRead: boolean; canWrite: boolean }> {
  if (session.role !== 'partner' || !session.partnerId) return { canRead: false, canWrite: false };
  const org = await prisma.organization.findFirst({
    where: { id: orgId, partnerId: session.partnerId },
    select: { id: true },
  });
  if (!org) return { canRead: false, canWrite: false };
  // assignedOrgIds — суженный скоуп партнёрского пользователя (пустой = все).
  const scope = session.assignedOrgIds ?? [];
  if (scope.length > 0 && !scope.includes(orgId)) return { canRead: false, canWrite: false };
  return { canRead: true, canWrite: session.partnerRole === 'admin' };
}

export async function getOrgRequisites(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<
  { ok: true; requisites: OrgRequisites } | { ok: false; error: 'forbidden' | 'not_found' }
> {
  const asOrgUser = session.role === 'organization' && activeMembership(session, orgId) !== null;
  if (!asOrgUser && !(await partnerAccess(prisma, session, orgId)).canRead)
    return { ok: false, error: 'forbidden' };
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: REQ_SELECT });
  if (!org) return { ok: false, error: 'not_found' };
  return { ok: true, requisites: org };
}

export async function setOrgRequisites(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string,
  input: RequisitesInput
): Promise<
  { ok: true } | { ok: false; error: 'forbidden' | 'not_found' | 'validation'; messages?: string[] }
> {
  const membership = session.role === 'organization' ? activeMembership(session, orgId) : null;
  const orgUserMayWrite =
    membership !== null && (membership.role === 'admin' || membership.role === 'leader');
  // У-62: партнёр-администратор своей организации правит реквизиты наравне с
  // администратором самой организации. Обычный партнёрский пользователь — нет.
  if (!orgUserMayWrite && !(await partnerAccess(prisma, session, orgId)).canWrite) {
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
      return {
        ok: false,
        error: 'validation',
        messages: ['Организация с таким ИНН уже существует'],
      };
    }
    throw e;
  }
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'requisites_changed',
    entity: 'organization',
    entityId: orgId,
    // Банковские счета в аудит не пишем целиком — только последние 4 цифры.
    after: {
      inn: v.inn,
      kpp: v.kpp,
      ogrn: v.ogrn,
      bic: v.bic,
      bankAccountTail: v.bankAccount?.slice(-4) ?? null,
    },
  });
  return { ok: true };
}
