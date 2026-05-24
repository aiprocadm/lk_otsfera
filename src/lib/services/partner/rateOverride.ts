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
): Promise<void> {
  if (!(input.newRate > 0 && input.newRate < 1)) {
    throw new Error('RATE_OUT_OF_RANGE: rate must be in (0, 1)');
  }

  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, partnerId: input.partnerId },
    select: { id: true, partnerCommissionRate: true }
  });
  if (!org) throw new Error('NOT_FOUND: organization not under given partner');

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: input.organizationId },
      data: {
        partnerCommissionRate: input.newRate,
        partnerCommissionRateNote: input.reason,
        partnerCommissionRateChangedAt: new Date(),
        partnerCommissionRateChangedBy: input.changedByUserId
      }
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
}

export async function clearOrgCommissionRate(
  prisma: PrismaClient,
  input: { organizationId: string; partnerId: string; reason: string; changedByUserId: string }
): Promise<void> {
  const org = await prisma.organization.findFirst({
    where: { id: input.organizationId, partnerId: input.partnerId },
    select: { id: true, partnerCommissionRate: true }
  });
  if (!org) throw new Error('NOT_FOUND');

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: input.organizationId },
      data: {
        partnerCommissionRate: null,
        partnerCommissionRateNote: null,
        partnerCommissionRateChangedAt: new Date(),
        partnerCommissionRateChangedBy: input.changedByUserId
      }
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
}
