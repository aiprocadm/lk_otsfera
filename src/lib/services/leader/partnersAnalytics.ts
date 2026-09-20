import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

/**
 * «Партнёры» (`У-243`, этап 7): сколько начислено и выплачено, сколько у
 * партнёра живых организаций, сколько обращений он прислал.
 *
 * Партнёр не принадлежит компании напрямую — связь идёт через организации.
 * Поэтому в отчёт попадают партнёры, у которых есть хотя бы одна организация
 * этой компании: иначе руководитель увидел бы чужих.
 *
 * Считается тремя запросами с группировкой, а не обходом партнёров по одному
 * (`У-248`).
 */
type PartnerAnalyticsRow = {
  partnerId: string;
  partnerName: string;
  organizations: number;
  accrued: string;
  paid: string;
  requests: number;
};

export type PartnersAnalyticsResult = {
  rows: PartnerAnalyticsRow[];
  totalAccrued: string;
  totalPaid: string;
};

/** Черновик — ещё не начисление: его можно переписать целиком. */
const COUNTED_STATUSES = ['approved', 'paid'] as const;

export async function getPartnersAnalytics(
  prisma: PrismaClient,
  args: { companyId: string; from: Date; to: Date }
): Promise<PartnersAnalyticsResult> {
  const orgs = await prisma.organization.findMany({
    where: { companyId: args.companyId, partnerId: { not: null } },
    select: { id: true, partnerId: true, partner: { select: { name: true } } },
  });
  if (orgs.length === 0) return { rows: [], totalAccrued: '0.00', totalPaid: '0.00' };

  const partnerIds = [...new Set(orgs.map((o) => o.partnerId).filter((p): p is string => !!p))];

  const [statements, requests] = await Promise.all([
    prisma.commissionStatement.findMany({
      where: {
        partnerId: { in: partnerIds },
        status: { in: [...COUNTED_STATUSES] },
        periodFrom: { gte: args.from, lt: args.to },
      },
      select: { partnerId: true, status: true, totalCommissionAmount: true },
    }),
    prisma.clientRequest.groupBy({
      by: ['partnerId'],
      where: {
        partnerId: { in: partnerIds },
        createdAt: { gte: args.from, lt: args.to },
      },
      _count: { _all: true },
    }),
  ]);

  const names = new Map<string, string>();
  const orgCount = new Map<string, number>();
  for (const o of orgs) {
    if (!o.partnerId) continue;
    names.set(o.partnerId, o.partner?.name ?? o.partnerId);
    orgCount.set(o.partnerId, (orgCount.get(o.partnerId) ?? 0) + 1);
  }

  const accrued = new Map<string, Prisma.Decimal>();
  const paid = new Map<string, Prisma.Decimal>();
  for (const s of statements) {
    accrued.set(
      s.partnerId,
      (accrued.get(s.partnerId) ?? new Prisma.Decimal(0)).plus(s.totalCommissionAmount)
    );
    // Выплачено — только то, что действительно отмечено выплаченным.
    if (s.status === 'paid') {
      paid.set(
        s.partnerId,
        (paid.get(s.partnerId) ?? new Prisma.Decimal(0)).plus(s.totalCommissionAmount)
      );
    }
  }

  const requestCount = new Map(requests.map((r) => [String(r.partnerId), r._count._all]));

  let totalAccrued = new Prisma.Decimal(0);
  let totalPaid = new Prisma.Decimal(0);
  const rows: PartnerAnalyticsRow[] = partnerIds.map((id) => {
    const a = accrued.get(id) ?? new Prisma.Decimal(0);
    const p = paid.get(id) ?? new Prisma.Decimal(0);
    totalAccrued = totalAccrued.plus(a);
    totalPaid = totalPaid.plus(p);
    return {
      partnerId: id,
      // Оба словаря заполняются из того же списка организаций, из которого
      // взяты `partnerIds`, поэтому промахнуться здесь нечем: запасные
      // значения стоят ради типов.
      /* v8 ignore next 2 */
      partnerName: names.get(id) ?? id,
      organizations: orgCount.get(id) ?? 0,
      accrued: a.toFixed(2),
      paid: p.toFixed(2),
      requests: requestCount.get(id) ?? 0,
    };
  });
  rows.sort((a, b) => Number(b.accrued) - Number(a.accrued));

  return { rows, totalAccrued: totalAccrued.toFixed(2), totalPaid: totalPaid.toFixed(2) };
}
