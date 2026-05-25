import { describe, expect, it } from 'vitest';
import {
  isOrgMember,
  isOrgAdmin,
  activeOrgIds,
  organizationOrgScopeFilter,
  organizationOrderScopeFilter,
  canSeeOrder,
  canSeeDocument
} from '@/lib/auth/organizationPolicy';
import type { SessionPayload } from '@/lib/auth/jwt';

function s(memberships: SessionPayload['organizationMemberships']): SessionPayload {
  return { sub: 'u', role: 'organization', organizationMemberships: memberships };
}

describe('activeOrgIds', () => {
  it('returns empty for missing memberships', () => {
    expect(activeOrgIds({ sub: 'u', role: 'organization' })).toEqual([]);
  });

  it('filters out inactive memberships', () => {
    const session = s([
      { organizationId: 'A', roleInOrg: 'admin', isActive: true },
      { organizationId: 'B', roleInOrg: 'member', isActive: false }
    ]);
    expect(activeOrgIds(session)).toEqual(['A']);
  });
});

describe('isOrgMember', () => {
  const session = s([
    { organizationId: 'A', roleInOrg: 'admin', isActive: true },
    { organizationId: 'B', roleInOrg: 'member', isActive: false }
  ]);

  it('true for active membership', () => {
    expect(isOrgMember(session, 'A')).toBe(true);
  });

  it('false for inactive membership', () => {
    expect(isOrgMember(session, 'B')).toBe(false);
  });

  it('false for unknown org', () => {
    expect(isOrgMember(session, 'X')).toBe(false);
  });
});

describe('isOrgAdmin', () => {
  const session = s([
    { organizationId: 'A', roleInOrg: 'admin', isActive: true },
    { organizationId: 'B', roleInOrg: 'member', isActive: true }
  ]);

  it('true for active admin role', () => {
    expect(isOrgAdmin(session, 'A')).toBe(true);
  });

  it('false for member role', () => {
    expect(isOrgAdmin(session, 'B')).toBe(false);
  });
});

describe('scope filters', () => {
  const session = s([
    { organizationId: 'A', roleInOrg: 'admin', isActive: true },
    { organizationId: 'B', roleInOrg: 'member', isActive: true }
  ]);

  it('organizationOrgScopeFilter returns id IN list', () => {
    expect(organizationOrgScopeFilter(session)).toEqual({ id: { in: ['A', 'B'] } });
  });

  it('organizationOrderScopeFilter returns organizationId IN list', () => {
    expect(organizationOrderScopeFilter(session)).toEqual({
      organizationId: { in: ['A', 'B'] }
    });
  });

  it('empty session yields empty filters (denies all)', () => {
    const empty = s([]);
    expect(organizationOrgScopeFilter(empty)).toEqual({ id: { in: [] } });
    expect(organizationOrderScopeFilter(empty)).toEqual({ organizationId: { in: [] } });
  });
});

describe('canSeeOrder', () => {
  const session = s([{ organizationId: 'A', roleInOrg: 'member', isActive: true }]);

  it('true for own org order', () => {
    expect(canSeeOrder(session, { organizationId: 'A' })).toBe(true);
  });

  it('false for foreign org order', () => {
    expect(canSeeOrder(session, { organizationId: 'B' })).toBe(false);
  });

  it('false for orphan order (organizationId=null)', () => {
    expect(canSeeOrder(session, { organizationId: null })).toBe(false);
  });
});

describe('canSeeDocument', () => {
  const session = s([{ organizationId: 'A', roleInOrg: 'member', isActive: true }]);

  it('true for own org document', () => {
    expect(canSeeDocument(session, { order: { organizationId: 'A' } })).toBe(true);
  });

  it('false for foreign org document', () => {
    expect(canSeeDocument(session, { order: { organizationId: 'B' } })).toBe(false);
  });

  it('false for orphan document', () => {
    expect(canSeeDocument(session, { order: { organizationId: null } })).toBe(false);
  });
});
