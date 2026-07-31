import { type Prisma } from '@prisma/client';

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
 * F4 (§16, A5): запись истории org-override. В отличие от партнёрской истории
 * `newRate` nullable: null = событие «очистка» (возврат к наследованию уровня
 * партнёра). `oldRate` null = до этой смены ставка не была задана.
 */
export type OrgRateChange = {
  effectiveFrom: Date;
  oldRate: Prisma.Decimal | null;
  newRate: Prisma.Decimal | null;
};

/**
 * F4: org-override, действовавший на момент `paidAt`, по таймлайну
 * `OrganizationCommissionRateChange`. Чистая функция, зеркало `resolveRateAt`.
 *
 * Пустая история → `fallback` (текущее `Organization.partnerCommissionRate`) —
 * это сохраняет поведение для организаций, чья ставка не менялась после
 * введения истории. `paidAt` раньше первой записи → `oldRate` первой записи
 * (значение до начала истории). Возврат null/undefined = «override на эту дату
 * не задан» → вызывающий проваливается на партнёрский уровень.
 */
export function resolveOrgOverrideAt(
  changes: OrgRateChange[],
  paidAt: Date,
  fallback: Prisma.Decimal | null | undefined
): Prisma.Decimal | null | undefined {
  if (changes.length === 0) return fallback;
  const asc = [...changes].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());

  let resolved: Prisma.Decimal | null | undefined;
  let found = false;
  for (const c of asc) {
    if (c.effectiveFrom.getTime() <= paidAt.getTime()) {
      resolved = c.newRate;
      found = true;
    } else break;
  }
  if (found) return resolved;

  // paidAt раньше всех записей: override до первой смены = её oldRate.
  return asc[0].oldRate;
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
 * «задано → применяем», а не «проваливаемся дальше».
 *
 * F4 (A5): при переданном `orgChanges` приоритет-1 берётся не из текущего
 * значения, а из истории на дату `paidAt` (`resolveOrgOverrideAt`); порядок
 * приоритетов не меняется. Без `orgChanges` (undefined) поведение идентично
 * прежнему — вызовы вне расчёта ведомостей не обязаны знать про историю.
 */
export function resolveEffectiveRate(args: {
  orgOverride: Prisma.Decimal | null | undefined;
  orgChanges?: OrgRateChange[];
  changes: RateChange[];
  paidAt: Date;
  partnerDefault: Prisma.Decimal;
}): Prisma.Decimal {
  const override =
    args.orgChanges !== undefined
      ? resolveOrgOverrideAt(args.orgChanges, args.paidAt, args.orgOverride)
      : args.orgOverride;
  if (override !== null && override !== undefined) return override;
  return resolveRateAt(args.changes, args.paidAt, args.partnerDefault);
}
