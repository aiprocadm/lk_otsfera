import { describe, it, expect } from 'vitest';
import { importScope } from '@/lib/services/oneCSync/scope';
import type { SessionPayload } from '@/lib/auth/jwt';

const base = (over: Partial<SessionPayload>): SessionPayload => ({ sub: 'u1', role: 'manager', ...over } as any);

describe('importScope', () => {
  it('admin → unscoped, may create', () => {
    expect(importScope(base({ role: 'admin' }))).toEqual({ unscoped: true, mayCreateOrgs: true });
  });
  it('manager-leader → unscoped, may create', () => {
    expect(importScope(base({ role: 'manager', managerRole: 'leader' }))).toEqual({ unscoped: true, mayCreateOrgs: true });
  });
  it('plain manager → scoped to managedOrgIds, may NOT create', () => {
    const s = importScope(base({ role: 'manager', managedOrgIds: ['o1', 'o2'] }));
    expect(s).toEqual({ unscoped: false, mayCreateOrgs: false, allowedOrgIds: ['o1', 'o2'] });
  });
  it('plain manager with no managedOrgIds → empty allowedOrgIds', () => {
    const s = importScope(base({ role: 'manager' }));
    expect(s).toEqual({ unscoped: false, mayCreateOrgs: false, allowedOrgIds: [] });
  });
  it('admin with non-empty managedOrgIds is still unscoped (role wins)', () => {
    const s = importScope(base({ role: 'admin', managedOrgIds: ['o1'] }));
    expect(s).toEqual({ unscoped: true, mayCreateOrgs: true });
  });
});
