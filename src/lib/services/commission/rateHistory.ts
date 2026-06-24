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
    orderBy: { effectiveFrom: 'desc' }
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
      changedByName: c.changedById ? (nameById.get(c.changedById) ?? null) : null
    }))
  };
}
