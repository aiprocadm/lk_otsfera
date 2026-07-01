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

/**
 * A2 (§6.2, разворот раннего решения): эффективная ставка платежа с приоритетом
 *   1. индивидуальная ставка организации (`Organization.partnerCommissionRate`,
 *      договорная скидка под клиента) — если задана;
 *   2. иначе — историческая ставка партнёра на `paidAt` (`resolveRateAt`);
 *   3. иначе — дефолт партнёра (`Partner.commissionRate`).
 *
 * `orgOverride === null/undefined` означает «не задана» → наследуем уровень
 * партнёра. Любое заданное значение (включая Decimal(0)) — явный override:
 * «задано → применяем», а не «проваливаемся дальше». A5 (история override)
 * намеренно отложена: применённая ставка фиксируется в `CommissionStatementItem.rate`,
 * чего достаточно для воспроизводимости прошлых периодов.
 */
export function resolveEffectiveRate(args: {
  orgOverride: Prisma.Decimal | null | undefined;
  changes: RateChange[];
  paidAt: Date;
  partnerDefault: Prisma.Decimal;
}): Prisma.Decimal {
  if (args.orgOverride !== null && args.orgOverride !== undefined) return args.orgOverride;
  return resolveRateAt(args.changes, args.paidAt, args.partnerDefault);
}
