/**
 * Unit tests for scan/visibility.ts — covers both branches of
 * hideInfectedForSession (admin → {} vs others → INFECTED_HIDDEN_WHERE).
 */
import { describe, it, expect } from 'vitest';
import { hideInfectedForSession, INFECTED_HIDDEN_WHERE } from '@/lib/services/scan/visibility';

describe('hideInfectedForSession', () => {
  it('returns empty object for admin (sees everything, including infected)', () => {
    const result = hideInfectedForSession({ role: 'admin' });
    expect(result).toEqual({});
  });

  it('returns INFECTED_HIDDEN_WHERE for manager role', () => {
    const result = hideInfectedForSession({ role: 'manager' });
    expect(result).toEqual(INFECTED_HIDDEN_WHERE);
  });

  it('returns INFECTED_HIDDEN_WHERE for partner role', () => {
    const result = hideInfectedForSession({ role: 'partner' });
    expect(result).toEqual(INFECTED_HIDDEN_WHERE);
  });

  it('returns INFECTED_HIDDEN_WHERE for organization role', () => {
    const result = hideInfectedForSession({ role: 'organization' });
    expect(result).toEqual(INFECTED_HIDDEN_WHERE);
  });

  it('INFECTED_HIDDEN_WHERE excludes infected scanStatus', () => {
    expect(INFECTED_HIDDEN_WHERE).toEqual({ scanStatus: { not: 'infected' } });
  });
});
