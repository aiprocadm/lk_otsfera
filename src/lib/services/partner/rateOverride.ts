import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

export type SetRateInput = {
  organizationId: string;
  partnerId: string;
  newRate: number;
  reason: string;
  changedByUserId: string;
};

export async function setOrgCommissionRate(
  prisma: PrismaClient,
  input: SetRateInput
): Promise<{ ok: true } | { ok: false; error: 'rate_out_of_range' | 'not_found' }> {
  if (!(input.newRate > 0 && input.newRate < 1)) {
    return { ok: false, error: 'rate_out_of_range' };
  }

  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, partnerId: input.partnerId },
    select: { id: true, partnerCommissionRate: true },
  });
  if (!org) return { ok: false, error: 'not_found' };

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: input.organizationId },
      data: {
        partnerCommissionRate: input.newRate,
        partnerCommissionRateNote: input.reason,
        partnerCommissionRateChangedAt: new Date(),
        partnerCommissionRateChangedBy: input.changedByUserId,
      },
    });
    // F4 (A5): append-only история — расчёт ведомости берёт override на paidAt.
    await tx.organizationCommissionRateChange.create({
      data: {
        organizationId: input.organizationId,
        oldRate: org.partnerCommissionRate,
        newRate: input.newRate,
        changedById: input.changedByUserId,
      },
    });
    await recordAudit(tx, {
      userId: input.changedByUserId,
      action: 'partner_commission_rate_changed',
      entity: 'organization',
      entityId: input.organizationId,
      before: { rate: org.partnerCommissionRate?.toString() ?? 'inherited' },
      after: { rate: input.newRate.toString() },
      reason: input.reason,
    });
  });

  return { ok: true };
}

export async function clearOrgCommissionRate(
  prisma: PrismaClient,
  input: { organizationId: string; partnerId: string; reason: string; changedByUserId: string }
): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, partnerId: input.partnerId },
    select: { id: true, partnerCommissionRate: true },
  });
  if (!org) return { ok: false, error: 'not_found' };

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: input.organizationId },
      data: {
        partnerCommissionRate: null,
        partnerCommissionRateNote: null,
        partnerCommissionRateChangedAt: new Date(),
        partnerCommissionRateChangedBy: input.changedByUserId,
      },
    });
    // F4 (A5): событие «очистка» — newRate null (возврат к наследованию).
    await tx.organizationCommissionRateChange.create({
      data: {
        organizationId: input.organizationId,
        oldRate: org.partnerCommissionRate,
        newRate: null,
        changedById: input.changedByUserId,
      },
    });
    await recordAudit(tx, {
      userId: input.changedByUserId,
      action: 'partner_commission_rate_changed',
      entity: 'organization',
      entityId: input.organizationId,
      before: { rate: org.partnerCommissionRate?.toString() ?? 'inherited' },
      after: { rate: 'cleared' },
      reason: input.reason,
    });
  });

  return { ok: true };
}
