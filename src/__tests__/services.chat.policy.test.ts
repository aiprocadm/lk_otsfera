import { describe, it, expect } from 'vitest';
import { canSeeThread, deriveSide } from '@/lib/services/chat/policy';
import type { SessionPayload } from '@/lib/auth/jwt';

const order = { id: 'o1', organizationId: 'org1', partnerId: 'p1', companyId: 'c1' };
const s = (over: Partial<SessionPayload>): SessionPayload =>
  ({ sub: 'u', role: 'manager', ...over } as SessionPayload);
const orgSess = (orgId: string) =>
  s({ role: 'organization', organizationMemberships: [{ organizationId: orgId, isActive: true, roleInOrg: 'member' }] as any });

describe('deriveSide', () => {
  it('org user → org', () => expect(deriveSide(s({ role: 'organization' }))).toBe('org'));
  it('partner user → partner', () => expect(deriveSide(s({ role: 'partner' }))).toBe('partner'));
  it('manager → null', () => expect(deriveSide(s({ role: 'manager' }))).toBeNull());
});

describe('canSeeThread', () => {
  it('manager sees both sides within own company', () => {
    expect(canSeeThread(s({ role: 'manager', companyId: 'c1' }), 'org', order)).toBe(true);
    expect(canSeeThread(s({ role: 'manager', companyId: 'c1' }), 'partner', order)).toBe(true);
  });
  it('manager cannot see threads of another company (C8 cross-company isolation)', () => {
    expect(canSeeThread(s({ role: 'manager', companyId: 'cX' }), 'org', order)).toBe(false);
    expect(canSeeThread(s({ role: 'manager', companyId: 'cX' }), 'partner', order)).toBe(false);
  });
  it('manager without companyId sees nothing (degrades to deny, not all)', () => {
    expect(canSeeThread(s({ role: 'manager' }), 'org', order)).toBe(false);
    expect(canSeeThread(s({ role: 'manager' }), 'org', { ...order, companyId: null })).toBe(false);
  });
  it('admin sees all', () => expect(canSeeThread(s({ role: 'admin' }), 'partner', order)).toBe(true));
  it('partner sees only partner side of own partner', () => {
    const sess = s({ role: 'partner', partnerId: 'p1' });
    expect(canSeeThread(sess, 'partner', order)).toBe(true);
    expect(canSeeThread(sess, 'org', order)).toBe(false);
  });
  it('partner cannot see another partner', () =>
    expect(canSeeThread(s({ role: 'partner', partnerId: 'pX' }), 'partner', order)).toBe(false));
  it('org user sees only org side of own org', () => {
    expect(canSeeThread(orgSess('org1'), 'org', order)).toBe(true);
    expect(canSeeThread(orgSess('org1'), 'partner', order)).toBe(false);
  });
  it('org user cannot see another org', () =>
    expect(canSeeThread(orgSess('orgX'), 'org', order)).toBe(false));
});
