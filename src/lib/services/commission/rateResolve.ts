import { Prisma } from '@prisma/client';

/**
 * A5 (§9.1): историческая ставка партнёра. Резолвит ставку, действовавшую на
 * момент `paidAt`, по таймлайну `CommissionRateChange`. Чистая функция — без
 * Prisma-запросов, тестируется без БД.
 */
export type RateChange = {
  effectiveFrom: Date;
  oldRate: Prisma.Decimal | null;
  newRate: Prisma.Decimal;
};

export function resolveRateAt(
  changes: RateChange[],
  paidAt: Date,
  partnerDefault: Prisma.Decimal
): Prisma.Decimal {
  if (changes.length === 0) return partnerDefault;
  const asc = [...changes].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());

  let resolved: Prisma.Decimal | null = null;
  for (const c of asc) {
    if (c.effectiveFrom.getTime() <= paidAt.getTime()) resolved = c.newRate;
    else break;
  }
  if (resolved !== null) return resolved;

  // paidAt раньше всех записей: ставка до первой смены = её oldRate, иначе дефолт.
  return asc[0].oldRate ?? partnerDefault;
}
