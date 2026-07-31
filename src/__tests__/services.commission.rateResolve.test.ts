import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  resolveRateAt,
  resolveEffectiveRate,
  resolveOrgOverrideAt,
  type RateChange,
  type OrgRateChange,
} from '@/lib/services/commission/rateResolve';

const d = (s: string) => new Date(s);
const dec = (n: number | string) => new Prisma.Decimal(n);

describe('resolveRateAt', () => {
  const partnerDefault = dec(0.1);

  it('returns partner default when there are no changes', () => {
    expect(resolveRateAt([], d('2026-04-10'), partnerDefault).toNumber()).toBe(0.1);
  });

  it('A5: picks the latest change with effectiveFrom <= paidAt', () => {
    const changes: RateChange[] = [
      { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.05) },
      { effectiveFrom: d('2026-04-15'), oldRate: dec(0.05), newRate: dec(0.2) },
    ];
    expect(resolveRateAt(changes, d('2026-04-14T23:59:59Z'), partnerDefault).toNumber()).toBe(0.05);
    expect(resolveRateAt(changes, d('2026-04-15T00:00:00Z'), partnerDefault).toNumber()).toBe(0.2);
    expect(resolveRateAt(changes, d('2026-04-20'), partnerDefault).toNumber()).toBe(0.2);
  });

  it('before all changes: falls back to earliest change oldRate when present', () => {
    const changes: RateChange[] = [
      { effectiveFrom: d('2026-03-01'), oldRate: dec(0.07), newRate: dec(0.05) },
    ];
    expect(resolveRateAt(changes, d('2026-01-01'), partnerDefault).toNumber()).toBe(0.07);
  });

  it('before all changes with null oldRate: falls back to partner default', () => {
    const changes: RateChange[] = [
      { effectiveFrom: d('2026-03-01'), oldRate: null, newRate: dec(0.05) },
    ];
    expect(resolveRateAt(changes, d('2026-01-01'), partnerDefault).toNumber()).toBe(0.1);
  });

  it('does not assume input order (sorts internally)', () => {
    const changes: RateChange[] = [
      { effectiveFrom: d('2026-04-15'), oldRate: dec(0.05), newRate: dec(0.2) },
      { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.05) },
    ];
    expect(resolveRateAt(changes, d('2026-02-01'), partnerDefault).toNumber()).toBe(0.05);
  });
});

// A2/§6.2: ставка платежа — приоритет (1) индивидуальная ставка организации →
// (2) историческая ставка партнёра на paidAt → (3) дефолт партнёра.
describe('resolveEffectiveRate (per-org override priority)', () => {
  const partnerDefault = dec(0.1);
  const changes: RateChange[] = [
    { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.05) },
    { effectiveFrom: d('2026-04-15'), oldRate: dec(0.05), newRate: dec(0.2) },
  ];

  it('priority 1: org override wins over partner history and default', () => {
    expect(
      resolveEffectiveRate({
        orgOverride: dec(0.07),
        changes,
        paidAt: d('2026-04-20'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.07);
  });

  it('priority 1: a contractual discount of 0 is still an explicit override (not inherited)', () => {
    // setOrgCommissionRate forbids 0, but the resolver must treat any set value
    // (incl. Decimal(0)) as the override — "set" means use it, not fall through.
    expect(
      resolveEffectiveRate({
        orgOverride: dec(0),
        changes,
        paidAt: d('2026-04-20'),
        partnerDefault,
      }).toNumber()
    ).toBe(0);
  });

  it('priority 2: no override → historical partner rate at paidAt', () => {
    expect(
      resolveEffectiveRate({
        orgOverride: null,
        changes,
        paidAt: d('2026-04-20'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.2);
    expect(
      resolveEffectiveRate({
        orgOverride: null,
        changes,
        paidAt: d('2026-04-14'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.05);
  });

  it('priority 3: no override and no history → partner default', () => {
    expect(
      resolveEffectiveRate({
        orgOverride: null,
        changes: [],
        paidAt: d('2026-04-20'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.1);
  });

  it('undefined override behaves like null (inherits)', () => {
    expect(
      resolveEffectiveRate({
        orgOverride: undefined,
        changes: [],
        paidAt: d('2026-04-20'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.1);
  });
});

// F4 (A5): org-override резолвится по истории OrganizationCommissionRateChange
// на дату paidAt — воспроизводимость при изменении договорной ставки задним числом.
describe('resolveOrgOverrideAt (F4 org rate history)', () => {
  it('empty history: falls back to the current override value (pre-F4 behaviour)', () => {
    expect(resolveOrgOverrideAt([], d('2026-04-10'), dec(0.07))?.toNumber()).toBe(0.07);
    expect(resolveOrgOverrideAt([], d('2026-04-10'), null)).toBeNull();
  });

  it('picks the latest change with effectiveFrom <= paidAt', () => {
    const changes: OrgRateChange[] = [
      { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.07) },
      { effectiveFrom: d('2026-05-01'), oldRate: dec(0.07), newRate: dec(0.03) },
    ];
    expect(resolveOrgOverrideAt(changes, d('2026-04-30'), dec(0.03))?.toNumber()).toBe(0.07);
    expect(resolveOrgOverrideAt(changes, d('2026-05-02'), dec(0.03))?.toNumber()).toBe(0.03);
  });

  it('clear event (newRate=null) means "no override" from that date on', () => {
    const changes: OrgRateChange[] = [
      { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.07) },
      { effectiveFrom: d('2026-05-01'), oldRate: dec(0.07), newRate: null },
    ];
    expect(resolveOrgOverrideAt(changes, d('2026-04-30'), null)?.toNumber()).toBe(0.07);
    expect(resolveOrgOverrideAt(changes, d('2026-05-02'), null)).toBeNull();
  });

  it('paidAt before all history: the earliest oldRate (value before history began)', () => {
    const changes: OrgRateChange[] = [
      { effectiveFrom: d('2026-03-01'), oldRate: dec(0.09), newRate: dec(0.07) },
    ];
    expect(resolveOrgOverrideAt(changes, d('2026-02-01'), dec(0.07))?.toNumber()).toBe(0.09);
  });

  it('paidAt before all history with null oldRate: no override existed then', () => {
    const changes: OrgRateChange[] = [
      { effectiveFrom: d('2026-03-01'), oldRate: null, newRate: dec(0.07) },
    ];
    expect(resolveOrgOverrideAt(changes, d('2026-02-01'), dec(0.07))).toBeNull();
  });

  it('does not assume input order (sorts internally)', () => {
    const changes: OrgRateChange[] = [
      { effectiveFrom: d('2026-05-01'), oldRate: dec(0.07), newRate: dec(0.03) },
      { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.07) },
    ];
    expect(resolveOrgOverrideAt(changes, d('2026-02-01'), null)?.toNumber()).toBe(0.07);
  });
});

describe('resolveEffectiveRate with orgChanges (F4 — priority preserved)', () => {
  const partnerDefault = dec(0.1);
  const changes: RateChange[] = [
    { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.05) },
  ];

  it('historical override at paidAt wins over partner history (priority 1 intact)', () => {
    const orgChanges: OrgRateChange[] = [
      { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.07) },
      { effectiveFrom: d('2026-05-01'), oldRate: dec(0.07), newRate: dec(0.03) },
    ];
    // Ставка изменена 2026-05-01 задним числом относительно платежа за апрель:
    // расчёт апреля обязан взять 0.07 (действовавшую), не текущие 0.03.
    expect(
      resolveEffectiveRate({
        orgOverride: dec(0.03),
        orgChanges,
        changes,
        paidAt: d('2026-04-10'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.07);
  });

  it('override not yet set at paidAt → partner level (history says "none then")', () => {
    const orgChanges: OrgRateChange[] = [
      { effectiveFrom: d('2026-05-01'), oldRate: null, newRate: dec(0.03) },
    ];
    expect(
      resolveEffectiveRate({
        orgOverride: dec(0.03),
        orgChanges,
        changes,
        paidAt: d('2026-04-10'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.05);
  });

  it('cleared at paidAt → partner level even though it was set before', () => {
    const orgChanges: OrgRateChange[] = [
      { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.07) },
      { effectiveFrom: d('2026-03-01'), oldRate: dec(0.07), newRate: null },
    ];
    expect(
      resolveEffectiveRate({
        orgOverride: null,
        orgChanges,
        changes,
        paidAt: d('2026-04-10'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.05);
  });

  it('empty history list falls back to current override (orgs untouched since F4)', () => {
    expect(
      resolveEffectiveRate({
        orgOverride: dec(0.07),
        orgChanges: [],
        changes,
        paidAt: d('2026-04-10'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.07);
  });

  it('omitted orgChanges keeps the exact pre-F4 behaviour', () => {
    expect(
      resolveEffectiveRate({
        orgOverride: dec(0.07),
        changes,
        paidAt: d('2026-04-10'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.07);
    expect(
      resolveEffectiveRate({
        orgOverride: null,
        changes,
        paidAt: d('2026-04-10'),
        partnerDefault,
      }).toNumber()
    ).toBe(0.05);
  });
});
