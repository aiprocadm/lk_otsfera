import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

export type RateHistoryRow = {
  id: string;
  oldRate: number | null;
  newRate: number;
  effectiveFrom: Date;
  changedByName: string | null;
};

export async function listRateHistory(
  prisma: PrismaClient,
  session: SessionPayload,
  partnerId: string
): Promise<{ ok: true; rows: RateHistoryRow[] } | { ok: false; error: 'forbidden' }> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };

  const changes = await prisma.commissionRateChange.findMany({
    where: { partnerId },
    orderBy: { effectiveFrom: 'desc' },
  });

  const ids = [...new Set(changes.map((c) => c.changedById).filter(Boolean) as string[])];
  const users =
    ids.length > 0
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return {
    ok: true,
    rows: changes.map((c) => ({
      id: c.id,
      oldRate: c.oldRate ? Number(c.oldRate) : null,
      newRate: Number(c.newRate),
      effectiveFrom: c.effectiveFrom,
      changedByName: c.changedById ? (nameById.get(c.changedById) ?? null) : null,
    })),
  };
}

/**
 * G4: история индивидуальной ставки организации (OrganizationCommissionRateChange).
 * Калька listRateHistory; отличие модели — newRate тоже nullable:
 * newRate = null означает событие «сброс к ставке партнёра».
 */
export type OrgRateHistoryRow = {
  id: string;
  oldRate: number | null;
  newRate: number | null;
  effectiveFrom: Date;
  changedByName: string | null;
};

export async function listOrgRateHistory(
  prisma: PrismaClient,
  session: SessionPayload,
  organizationId: string
): Promise<{ ok: true; rows: OrgRateHistoryRow[] } | { ok: false; error: 'forbidden' }> {
  // `У-99`: историю ставки видят администратор и руководитель. У руководителя
  // граница — своя компания (C8): чужую организацию он не смотрит даже на
  // чтение, иначе через историю утекли бы ставки соседней компании.
  if (session.role !== 'admin') {
    if (session.role !== 'leader' || !session.companyId) return { ok: false, error: 'forbidden' };
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { companyId: true },
    });
    if (!org || org.companyId !== session.companyId) return { ok: false, error: 'forbidden' };
  }

  const changes = await prisma.organizationCommissionRateChange.findMany({
    where: { organizationId },
    orderBy: { effectiveFrom: 'desc' },
  });

  const ids = [...new Set(changes.map((c) => c.changedById).filter(Boolean) as string[])];
  const users =
    ids.length > 0
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return {
    ok: true,
    rows: changes.map((c) => ({
      id: c.id,
      oldRate: c.oldRate ? Number(c.oldRate) : null,
      newRate: c.newRate ? Number(c.newRate) : null,
      effectiveFrom: c.effectiveFrom,
      changedByName: c.changedById ? (nameById.get(c.changedById) ?? null) : null,
    })),
  };
}
