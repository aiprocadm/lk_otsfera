import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  can,
  orderWhereForLevel,
  leadWhereForLevel,
  toSessionAccessProfile,
  scopeLevelSchema,
  capabilitySchema,
  sessionAccessProfileSchema,
  NO_COMPANY_SENTINEL,
  type SessionAccessProfile
} from '@/lib/auth/accessProfile';

// Minimal session builders (mirror the inline-literal pattern used across tests).
function mgr(over: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: 'u1', role: 'manager', companyId: 'co-1', managedOrgIds: [], ...over } as unknown as SessionPayload;
}
function admin(over: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: 'a1', role: 'admin', ...over } as unknown as SessionPayload;
}

const fullProfile = (over: Partial<SessionAccessProfile> = {}): SessionAccessProfile => ({
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

describe('can()', () => {
  it('admin sees everything regardless of profile', () => {
    expect(can(admin(), 'see_commission')).toBe(true);
    expect(can(admin(), 'export')).toBe(true);
  });

  it('no-profile leader sees commission (legacy backward-compat)', () => {
    expect(can(mgr({ managerRole: 'leader' }), 'see_commission')).toBe(true);
  });

  it('no-profile plain manager does NOT see commission (legacy backward-compat)', () => {
    expect(can(mgr({ managerRole: null }), 'see_commission')).toBe(false);
  });

  it('no-profile session denies non-commission capabilities', () => {
    expect(can(mgr({ managerRole: 'leader' }), 'export')).toBe(false);
    expect(can(mgr({ managerRole: 'leader' }), 'manage_users')).toBe(false);
  });

  it('profiled: capability granted only if present (default-deny)', () => {
    expect(can(mgr({ accessProfile: fullProfile({ capabilities: ['see_commission'] }) }), 'see_commission')).toBe(true);
    expect(can(mgr({ accessProfile: fullProfile({ capabilities: [] }) }), 'see_commission')).toBe(false);
    expect(can(mgr({ accessProfile: fullProfile({ capabilities: ['export'] }) }), 'export')).toBe(true);
    expect(can(mgr({ accessProfile: fullProfile({ capabilities: ['export'] }) }), 'see_commission')).toBe(false);
  });

  it('profile overrides leader: leader-built role without flag cannot see commission', () => {
    const s = mgr({ managerRole: 'leader', accessProfile: fullProfile({ capabilities: [] }) });
    expect(can(s, 'see_commission')).toBe(false);
  });
});

describe('orderWhereForLevel()', () => {
  it('all → company-only filter', () => {
    expect(orderWhereForLevel(mgr({ companyId: 'co-1' }), 'all')).toEqual({ companyId: 'co-1' });
  });

  it('own → company AND managerId==sub', () => {
    expect(orderWhereForLevel(mgr({ companyId: 'co-1', sub: 'u1' }), 'own')).toEqual({
      AND: [{ companyId: 'co-1' }, { managerId: 'u1' }]
    });
  });

  it('assigned → company AND organizationId in managedOrgIds', () => {
    expect(orderWhereForLevel(mgr({ companyId: 'co-1', managedOrgIds: ['o1', 'o2'] }), 'assigned')).toEqual({
      AND: [{ companyId: 'co-1' }, { organizationId: { in: ['o1', 'o2'] } }]
    });
  });

  it('null companyId falls back to the no-company sentinel (fail-safe deny)', () => {
    expect(orderWhereForLevel(mgr({ companyId: null }), 'all')).toEqual({ companyId: NO_COMPANY_SENTINEL });
  });
});

describe('leadWhereForLevel() — leads single-tenant (no company floor)', () => {
  it('all → team-wide (empty filter, ≡ legacy)', () => {
    expect(leadWhereForLevel(mgr(), 'all')).toEqual({});
  });
  it('own → assignedManagerId == sub', () => {
    expect(leadWhereForLevel(mgr({ sub: 'u7' }), 'own')).toEqual({ assignedManagerId: 'u7' });
  });
  it('assigned → own OR managed orgs', () => {
    expect(leadWhereForLevel(mgr({ sub: 'u7', managedOrgIds: ['o1', 'o2'] }), 'assigned')).toEqual({
      OR: [{ assignedManagerId: 'u7' }, { organizationId: { in: ['o1', 'o2'] } }]
    });
  });
});

describe('toSessionAccessProfile()', () => {
  it('maps DB row scope columns to session shape and filters unknown capabilities', () => {
    const row = {
      id: 'p1',
      name: 'Оператор',
      ordersScope: 'assigned' as const,
      organizationsScope: 'all' as const,
      threadsScope: 'assigned' as const,
      documentsScope: 'own' as const,
      financeScope: 'own' as const,
      leadsScope: 'all' as const,
      capabilities: ['see_commission', 'garbage', 'export']
    };
    expect(toSessionAccessProfile(row)).toEqual({
      id: 'p1',
      name: 'Оператор',
      orders: 'assigned',
      organizations: 'all',
      threads: 'assigned',
      documents: 'own',
      finance: 'own',
      leads: 'all',
      capabilities: ['see_commission', 'export']
    });
  });
});

describe('schemas', () => {
  it('scopeLevelSchema accepts valid levels and rejects junk', () => {
    expect(scopeLevelSchema.parse('own')).toBe('own');
    expect(scopeLevelSchema.safeParse('everything').success).toBe(false);
  });

  it('capabilitySchema accepts known caps and rejects unknown', () => {
    expect(capabilitySchema.parse('see_commission')).toBe('see_commission');
    expect(capabilitySchema.safeParse('root').success).toBe(false);
  });

  it('sessionAccessProfileSchema validates a full profile and rejects a bad scope', () => {
    expect(sessionAccessProfileSchema.safeParse(fullProfile()).success).toBe(true);
    expect(
      sessionAccessProfileSchema.safeParse({ ...fullProfile(), orders: 'nonsense' }).success
    ).toBe(false);
  });
});
