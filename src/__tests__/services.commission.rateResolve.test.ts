import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { resolveRateAt, type RateChange } from '@/lib/services/commission/rateResolve';

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
