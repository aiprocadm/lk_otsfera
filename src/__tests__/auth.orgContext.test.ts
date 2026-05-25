import { describe, expect, it } from 'vitest';
import { resolveActiveOrgId } from '@/lib/auth/orgContext';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION_AB: SessionPayload = {
  sub: 'u-1',
  role: 'organization',
  organizationMemberships: [
    { organizationId: 'A', roleInOrg: 'admin', isActive: true },
    { organizationId: 'B', roleInOrg: 'member', isActive: true }
  ]
};

const SESSION_A_ONLY: SessionPayload = {
  sub: 'u-2',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'A', roleInOrg: 'admin', isActive: true }]
};

describe('resolveActiveOrgId', () => {
  it('returns query value when it matches a membership', () => {
    expect(resolveActiveOrgId(SESSION_AB, 'B', undefined)).toBe('B');
  });

  it('falls back to cookie when query is invalid (not a member)', () => {
    expect(resolveActiveOrgId(SESSION_AB, 'NOPE', 'B')).toBe('B');
  });

  it('falls back to first active when neither query nor cookie valid', () => {
    expect(resolveActiveOrgId(SESSION_AB, 'NOPE', 'ALSO-NOPE')).toBe('A');
  });

  it('falls back to first active when both query and cookie are missing', () => {
    expect(resolveActiveOrgId(SESSION_AB, undefined, undefined)).toBe('A');
  });

  it('handles null inputs (e.g. from cookies API)', () => {
    expect(resolveActiveOrgId(SESSION_AB, null, null)).toBe('A');
  });

  it('returns the single active org when only one is available', () => {
    expect(resolveActiveOrgId(SESSION_A_ONLY, undefined, undefined)).toBe('A');
    expect(resolveActiveOrgId(SESSION_A_ONLY, 'A', undefined)).toBe('A');
  });

  it('throws when session has no active memberships (invariant violated)', () => {
    expect(() =>
      resolveActiveOrgId(
        { sub: 'u-3', role: 'organization' },
        undefined,
        undefined
      )
    ).toThrow(/no active organization memberships/);

    expect(() =>
      resolveActiveOrgId(
        {
          sub: 'u-4',
          role: 'organization',
          organizationMemberships: [
            { organizationId: 'X', roleInOrg: 'admin', isActive: false }
          ]
        },
        undefined,
        undefined
      )
    ).toThrow();
  });
});
