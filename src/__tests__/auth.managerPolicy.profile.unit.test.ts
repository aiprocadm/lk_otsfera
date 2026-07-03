import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  managerOrderScope,
  managerDocumentScope,
  managerOrgScope,
  managerOrderScopeFilter,
  managerOrgScopeFilter,
  canSeeOrder
} from '@/lib/auth/managerPolicy';
import type { SessionAccessProfile } from '@/lib/auth/accessProfile';

const profile = (over: Partial<SessionAccessProfile> = {}): SessionAccessProfile => ({
  id: 'p1',
  name: 'Роль',
  orders: 'all',
  organizations: 'all',
  threads: 'all',
  documents: 'all',
  finance: 'all',
  leads: 'all',
  capabilities: [],
  ...over
});

function mgr(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: 'u1',
    role: 'manager',
    companyId: 'co-1',
    managedOrgIds: ['o1', 'o2'],
    ...over
  } as unknown as SessionPayload;
}

const order = (over: Partial<{ managerId: string | null; organizationId: string | null; companyId: string | null }> = {}) => ({
  managerId: 'u1',
  organizationId: 'o1',
  companyId: 'co-1',
  ...over
});

// ─── managerOrderScope ───────────────────────────────────────────────────────
describe('managerOrderScope — profile-first', () => {
  it('profile all → company-only (ignores teamMode)', () => {
    expect(managerOrderScope(mgr({ accessProfile: profile({ orders: 'all' }) }), false)).toEqual({ companyId: 'co-1' });
  });
  it('profile own → company AND managerId', () => {
    expect(managerOrderScope(mgr({ accessProfile: profile({ orders: 'own' }) }), true)).toEqual({
      AND: [{ companyId: 'co-1' }, { managerId: 'u1' }]
    });
  });
  it('profile assigned → company AND org in managedOrgIds', () => {
    expect(managerOrderScope(mgr({ accessProfile: profile({ orders: 'assigned' }) }), false)).toEqual({
      AND: [{ companyId: 'co-1' }, { organizationId: { in: ['o1', 'o2'] } }]
    });
  });
});

describe('managerOrderScope — no profile is byte-identical to legacy', () => {
  it('teamMode=false → three-way OR (unchanged)', () => {
    const s = mgr();
    expect(managerOrderScope(s, false)).toEqual(managerOrderScopeFilter(s));
  });
  it('teamMode=true → company-wide (unchanged)', () => {
    expect(managerOrderScope(mgr(), true)).toEqual({ companyId: 'co-1' });
  });
});

// ─── managerDocumentScope ────────────────────────────────────────────────────
describe('managerDocumentScope — profile-first', () => {
  it('profile documents level drives inner order filter + scan gate', () => {
    expect(managerDocumentScope(mgr({ accessProfile: profile({ documents: 'own' }) }), false)).toEqual({
      order: { AND: [{ companyId: 'co-1' }, { managerId: 'u1' }] },
      scanStatus: { not: 'infected' }
    });
  });
  it('no profile → legacy order scope wrapped with scan gate', () => {
    const s = mgr();
    expect(managerDocumentScope(s, false)).toEqual({
      order: managerOrderScopeFilter(s),
      scanStatus: { not: 'infected' }
    });
  });
});

// ─── managerOrgScope ─────────────────────────────────────────────────────────
describe('managerOrgScope — profile-first', () => {
  it('profile all → company-only', () => {
    expect(managerOrgScope(mgr({ accessProfile: profile({ organizations: 'all' }) }), false)).toEqual({ companyId: 'co-1' });
  });
  it('profile assigned → company AND managedOrgIds', () => {
    expect(managerOrgScope(mgr({ accessProfile: profile({ organizations: 'assigned' }) }), true)).toEqual({
      AND: [{ companyId: 'co-1' }, managerOrgScopeFilter(mgr())]
    });
  });
  it('no profile teamMode=false → managedOrgIds only (unchanged)', () => {
    const s = mgr();
    expect(managerOrgScope(s, false)).toEqual(managerOrgScopeFilter(s));
  });
  it('no profile teamMode=true → company-only (unchanged)', () => {
    expect(managerOrgScope(mgr(), true)).toEqual({ companyId: 'co-1' });
  });
});

// ─── canSeeOrder ─────────────────────────────────────────────────────────────
describe('canSeeOrder — profile-first with company floor', () => {
  it('profile all: same company true, other company false', () => {
    const s = mgr({ accessProfile: profile({ orders: 'all' }) });
    expect(canSeeOrder(s, order({ companyId: 'co-1' }), false)).toBe(true);
    expect(canSeeOrder(s, order({ companyId: 'co-2' }), false)).toBe(false);
  });
  it('profile own: only own orders in company', () => {
    const s = mgr({ accessProfile: profile({ orders: 'own' }) });
    expect(canSeeOrder(s, order({ managerId: 'u1' }), false)).toBe(true);
    expect(canSeeOrder(s, order({ managerId: 'u2' }), false)).toBe(false);
  });
  it('profile assigned: only assigned orgs in company', () => {
    const s = mgr({ accessProfile: profile({ orders: 'assigned' }) });
    expect(canSeeOrder(s, order({ managerId: 'u2', organizationId: 'o1' }), false)).toBe(true);
    expect(canSeeOrder(s, order({ managerId: 'u2', organizationId: 'o9' }), false)).toBe(false);
  });
  it('company floor beats any profile level', () => {
    const s = mgr({ accessProfile: profile({ orders: 'all' }) });
    expect(canSeeOrder(s, order({ companyId: 'co-2' }), false)).toBe(false);
  });
});

describe('canSeeOrder — no profile is byte-identical to legacy', () => {
  it('teamMode=true → same-company check', () => {
    const s = mgr();
    expect(canSeeOrder(s, order({ companyId: 'co-1' }), true)).toBe(true);
    expect(canSeeOrder(s, order({ companyId: 'co-2' }), true)).toBe(false);
  });
  it('scoped: managerId / managedOrgIds / comments-history', () => {
    const s = mgr();
    expect(canSeeOrder(s, order({ managerId: 'u1', organizationId: 'o9' }), false)).toBe(true);
    expect(canSeeOrder(s, order({ managerId: 'u2', organizationId: 'o1' }), false)).toBe(true);
    expect(canSeeOrder(s, { managerId: 'u2', organizationId: 'o9', companyId: 'co-1', commentsCountByMe: 1 }, false)).toBe(true);
    expect(canSeeOrder(s, order({ managerId: 'u2', organizationId: 'o9' }), false)).toBe(false);
  });
});
