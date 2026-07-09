import { describe, it, expect } from 'vitest';
import { importScope } from '@/lib/services/oneCSync/scope';
import type { SessionPayload } from '@/lib/auth/jwt';

const base = (over: Partial<SessionPayload>): SessionPayload => ({ sub: 'u1', role: 'manager', ...over } as any);

describe('importScope', () => {
  it('admin → global (cross-company, Model A)', () => {
    expect(importScope(base({ role: 'admin' }))).toEqual({ kind: 'global' });
  });
  it('manager-leader → bounded to their OWN company (C8), NOT global', () => {
    expect(importScope(base({ role: 'manager', managerRole: 'leader', companyId: 'c1' }))).toEqual({ kind: 'company', companyId: 'c1' });
  });
  it('manager-leader with no companyId → degrades to assigned-orgs (never global)', () => {
    const s = importScope(base({ role: 'manager', managerRole: 'leader', companyId: null, managedOrgIds: ['o1'] }));
    expect(s).toEqual({ kind: 'orgs', allowedOrgIds: ['o1'] });
  });
  it('plain manager → scoped to managedOrgIds', () => {
    const s = importScope(base({ role: 'manager', managedOrgIds: ['o1', 'o2'] }));
    expect(s).toEqual({ kind: 'orgs', allowedOrgIds: ['o1', 'o2'] });
  });
  it('plain manager with no managedOrgIds → empty allowedOrgIds', () => {
    const s = importScope(base({ role: 'manager' }));
    expect(s).toEqual({ kind: 'orgs', allowedOrgIds: [] });
  });
  it('admin with non-empty managedOrgIds is still global (role wins)', () => {
    const s = importScope(base({ role: 'admin', managedOrgIds: ['o1'] }));
    expect(s).toEqual({ kind: 'global' });
  });
});
