import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { validateRequisites, type RequisitesInput, type RequisitesValues } from '@/lib/requisites/validate';

/**
 * Этап 8 (ФТ-9.2, PR-1) — реквизиты партнёра (самообслуживание).
 * Запись — только partner-admin (partnerRole='admin'); partner-manager читает.
 */

export type PartnerRequisites = RequisitesValues & { name: string };

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

export async function getPartnerRequisites(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; requisites: PartnerRequisites } | { ok: false; error: 'forbidden' | 'not_found' }> {
  if (session.role !== 'partner' || !session.partnerId) return { ok: false, error: 'forbidden' };
  const partner = await prisma.partner.findUnique({ where: { id: session.partnerId }, select: REQ_SELECT });
  if (!partner) return { ok: false, error: 'not_found' };
  return { ok: true, requisites: partner };
}

export async function setPartnerRequisites(
  prisma: PrismaClient,
  session: SessionPayload,
  input: RequisitesInput
): Promise<{ ok: true } | { ok: false; error: 'forbidden' | 'not_found' | 'validation'; messages?: string[] }> {
  if (session.role !== 'partner' || !session.partnerId || session.partnerRole !== 'admin') {
    return { ok: false, error: 'forbidden' };
  }

  const validated = validateRequisites(input);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };
  const v = validated.values;

  const before = await prisma.partner.findUnique({ where: { id: session.partnerId }, select: { id: true } });
  if (!before) return { ok: false, error: 'not_found' };

  try {
    await prisma.partner.update({ where: { id: session.partnerId }, data: v });
  } catch (e) {
    // Partner.inn @unique — дубль превращаем в понятную валидацию.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { ok: false, error: 'validation', messages: ['Партнёр с таким ИНН уже существует'] };
    }
    throw e;
  }
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'requisites_changed',
    entity: 'partner',
    entityId: session.partnerId,
    after: { inn: v.inn, kpp: v.kpp, ogrn: v.ogrn, bic: v.bic, bankAccountTail: v.bankAccount?.slice(-4) ?? null }
  });
  return { ok: true };
}
