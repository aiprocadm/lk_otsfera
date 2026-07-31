import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { validateRequisites, type RequisitesInput } from '@/lib/requisites/validate';

/**
 * Этап 8 (ФТ-9.2, PR-1) — правка реквизитов организации/партнёра сотрудником
 * из админ-зеркала (Model A: admin — полный доступ). Та же валидация и аудит,
 * что у самообслуживания; ИНН-дубль → понятная валидация (@unique).
 */

type SetResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'not_found' | 'validation'; messages?: string[] };

const REQ_SELECT = {
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

export type CounterpartyRequisites = { [K in keyof typeof REQ_SELECT]: string | null };

export async function getOrgRequisitesByAdmin(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<CounterpartyRequisites | null> {
  if (session.role !== 'admin') return null;
  return prisma.organization.findUnique({ where: { id: orgId }, select: REQ_SELECT });
}

export async function getPartnerRequisitesByAdmin(
  prisma: PrismaClient,
  session: SessionPayload,
  partnerId: string
): Promise<CounterpartyRequisites | null> {
  if (session.role !== 'admin') return null;
  return prisma.partner.findUnique({ where: { id: partnerId }, select: REQ_SELECT });
}

export async function setOrgRequisitesByAdmin(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string,
  input: RequisitesInput
): Promise<SetResult> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  const validated = validateRequisites(input);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };
  const v = validated.values;

  const before = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  if (!before) return { ok: false, error: 'not_found' };
  try {
    await prisma.organization.update({ where: { id: orgId }, data: v });
  } catch (e) {
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

export async function setPartnerRequisitesByAdmin(
  prisma: PrismaClient,
  session: SessionPayload,
  partnerId: string,
  input: RequisitesInput
): Promise<SetResult> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  const validated = validateRequisites(input);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };
  const v = validated.values;

  const before = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { id: true },
  });
  if (!before) return { ok: false, error: 'not_found' };
  try {
    await prisma.partner.update({ where: { id: partnerId }, data: v });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: 'validation', messages: ['Партнёр с таким ИНН уже существует'] };
    }
    throw e;
  }
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'requisites_changed',
    entity: 'partner',
    entityId: partnerId,
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
