import { describe, expect, it } from 'vitest';
import {
  managedOrgIds,
  managerOrderScopeFilter,
  managerDocumentScopeFilter,
  managerOrgScopeFilter,
  canSeeOrder,
  canSeeDocument,
  canSeeOrganization,
  isOrgInScope,
  companyWideOrderFilter,
  managerOrderScope,
  managerDocumentScope,
  managerOrgScope,
  isManagerLeader,
  isLeaderSameCompany
} from '@/lib/auth/managerPolicy';
import type { SessionPayload } from '@/lib/auth/jwt';

function makeSession(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    sub: 'user-1',
    role: 'manager',
    ...overrides
  };
}

describe('managedOrgIds', () => {
  it('returns empty array when managedOrgIds is undefined', () => {
    expect(managedOrgIds(makeSession())).toEqual([]);
  });

  it('returns the configured org list', () => {
    const session = makeSession({ managedOrgIds: ['org-A', 'org-B'] });
    expect(managedOrgIds(session)).toEqual(['org-A', 'org-B']);
  });

  it('returns empty array when managedOrgIds is explicitly empty', () => {
    expect(managedOrgIds(makeSession({ managedOrgIds: [] }))).toEqual([]);
  });
});

describe('managerOrderScopeFilter', () => {
  it('produces three OR clauses with the correct userId and orgIds', () => {
    const session = makeSession({ managedOrgIds: ['org-A', 'org-B'] });
    expect(managerOrderScopeFilter(session)).toEqual({
      OR: [
        { managerId: 'user-1' },
        { organizationId: { in: ['org-A', 'org-B'] } },
        { comments: { some: { authorId: 'user-1' } } }
      ]
    });
  });

  it('uses an empty list when managedOrgIds is undefined (still three clauses)', () => {
    const session = makeSession();
    expect(managerOrderScopeFilter(session)).toEqual({
      OR: [
        { managerId: 'user-1' },
        { organizationId: { in: [] } },
        { comments: { some: { authorId: 'user-1' } } }
      ]
    });
  });
});

describe('managerDocumentScopeFilter', () => {
  it('wraps the order filter and excludes infected documents', () => {
    const session = makeSession({ managedOrgIds: ['org-A'] });
    expect(managerDocumentScopeFilter(session)).toEqual({
      order: {
        OR: [
          { managerId: 'user-1' },
          { organizationId: { in: ['org-A'] } },
          { comments: { some: { authorId: 'user-1' } } }
        ]
      },
      scanStatus: { not: 'infected' }
    });
  });
});

describe('managerOrgScopeFilter', () => {
  it('returns id IN list of managedOrgIds', () => {
    const session = makeSession({ managedOrgIds: ['org-A', 'org-B'] });
    expect(managerOrgScopeFilter(session)).toEqual({ id: { in: ['org-A', 'org-B'] } });
  });

  it('returns empty IN list when nothing is managed (denies all)', () => {
    expect(managerOrgScopeFilter(makeSession())).toEqual({ id: { in: [] } });
  });
});

describe('canSeeOrder', () => {
  it('true when managerId equals session.sub', () => {
    const session = makeSession();
    expect(
      canSeeOrder(session, { managerId: 'user-1', organizationId: null })
    ).toBe(true);
  });

  it('true when organizationId is in managed scope', () => {
    const session = makeSession({ managedOrgIds: ['org-A'] });
    expect(
      canSeeOrder(session, { managerId: 'someone-else', organizationId: 'org-A' })
    ).toBe(true);
  });

  it('true when commentsCountByMe > 0 (historical access)', () => {
    const session = makeSession();
    expect(
      canSeeOrder(session, {
        managerId: 'someone-else',
        organizationId: 'org-X',
        commentsCountByMe: 2
      })
    ).toBe(true);
  });

  it('false when nothing matches', () => {
    const session = makeSession({ managedOrgIds: ['org-A'] });
    expect(
      canSeeOrder(session, {
        managerId: 'someone-else',
        organizationId: 'org-X',
        commentsCountByMe: 0
      })
    ).toBe(false);
  });

  it('false for orphan order (null managerId, null organizationId, no comments)', () => {
    const session = makeSession({ managedOrgIds: ['org-A'] });
    expect(
      canSeeOrder(session, { managerId: null, organizationId: null })
    ).toBe(false);
  });

  it('false when commentsCountByMe is undefined and no other match', () => {
    const session = makeSession({ managedOrgIds: ['org-A'] });
    expect(
      canSeeOrder(session, { managerId: null, organizationId: 'org-X' })
    ).toBe(false);
  });
});

describe('canSeeDocument', () => {
  it('delegates to canSeeOrder via doc.order', () => {
    const session = makeSession({ managedOrgIds: ['org-A'] });
    expect(
      canSeeDocument(session, { order: { managerId: null, organizationId: 'org-A' } })
    ).toBe(true);
  });

  it('false when underlying order is not visible', () => {
    const session = makeSession({ managedOrgIds: ['org-A'] });
    expect(
      canSeeDocument(session, { order: { managerId: null, organizationId: 'org-X' } })
    ).toBe(false);
  });
});

describe('canSeeOrganization', () => {
  it('true when orgId is in scope', () => {
    const session = makeSession({ managedOrgIds: ['org-A', 'org-B'] });
    expect(canSeeOrganization(session, 'org-A')).toBe(true);
  });

  it('false when orgId is not in scope', () => {
    const session = makeSession({ managedOrgIds: ['org-A'] });
    expect(canSeeOrganization(session, 'org-X')).toBe(false);
  });

  it('false when scope is empty', () => {
    expect(canSeeOrganization(makeSession(), 'org-A')).toBe(false);
  });
});

describe('isOrgInScope (alias)', () => {
  it('is the same function reference as canSeeOrganization', () => {
    expect(isOrgInScope).toBe(canSeeOrganization);
  });
});

describe('companyWideOrderFilter', () => {
  it('filters by session.companyId', () => {
    const session = makeSession({ companyId: 'co-1' });
    expect(companyWideOrderFilter(session)).toEqual({ companyId: 'co-1' });
  });

  it('falls back to a never-match sentinel when companyId is missing', () => {
    expect(companyWideOrderFilter(makeSession())).toEqual({ companyId: '__no_company__' });
  });
});

describe('managerOrderScope (resolver)', () => {
  it('teamMode=false returns the legacy three-way OR', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(managerOrderScope(session, false)).toEqual(managerOrderScopeFilter(session));
  });

  it('teamMode=true returns the company-wide filter', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(managerOrderScope(session, true)).toEqual({ companyId: 'co-1' });
  });
});

describe('managerOrgScope (resolver)', () => {
  it('teamMode=false returns id IN managedOrgIds', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(managerOrgScope(session, false)).toEqual({ id: { in: ['org-A'] } });
  });
  it('teamMode=true returns companyId filter', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(managerOrgScope(session, true)).toEqual({ companyId: 'co-1' });
  });
});

describe('canSeeOrder with teamMode', () => {
  it('teamMode=true: visible iff order.companyId === session.companyId', () => {
    const session = makeSession({ companyId: 'co-1' });
    expect(canSeeOrder(session, { managerId: 'other', organizationId: 'org-X', companyId: 'co-1' }, true)).toBe(true);
    expect(canSeeOrder(session, { managerId: 'other', organizationId: 'org-X', companyId: 'co-2' }, true)).toBe(false);
  });
  it('teamMode=true with no session.companyId denies', () => {
    expect(canSeeOrder(makeSession(), { managerId: null, organizationId: null, companyId: 'co-1' }, true)).toBe(false);
  });
  it('teamMode=false keeps the legacy three-way semantics', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(canSeeOrder(session, { managerId: 'user-1', organizationId: null, companyId: 'co-2' }, false)).toBe(true);
  });
});

describe('managerDocumentScope (resolver)', () => {
  it('teamMode=false wraps legacy order filter + excludes infected', () => {
    const session = makeSession({ managedOrgIds: ['org-A'], companyId: 'co-1' });
    expect(managerDocumentScope(session, false)).toEqual({
      order: managerOrderScopeFilter(session),
      scanStatus: { not: 'infected' }
    });
  });
  it('teamMode=true uses company-wide order filter + excludes infected', () => {
    const session = makeSession({ companyId: 'co-1' });
    expect(managerDocumentScope(session, true)).toEqual({
      order: { companyId: 'co-1' },
      scanStatus: { not: 'infected' }
    });
  });
});

describe('isManagerLeader', () => {
  it('true only for role=manager + managerRole=leader', () => {
    expect(isManagerLeader(makeSession({ managerRole: 'leader' }))).toBe(true);
    expect(isManagerLeader(makeSession())).toBe(false);
    expect(isManagerLeader(makeSession({ role: 'admin', managerRole: 'leader' }))).toBe(false);
  });
});

describe('isLeaderSameCompany', () => {
  it('true for leader + matching companyId', () => {
    const session = makeSession({ managerRole: 'leader', companyId: 'co-1' });
    expect(isLeaderSameCompany(session, 'co-1')).toBe(true);
  });

  it('false for leader + different companyId', () => {
    const session = makeSession({ managerRole: 'leader', companyId: 'co-1' });
    expect(isLeaderSameCompany(session, 'co-2')).toBe(false);
  });

  it('false for leader with null session.companyId (degrades to scoped path)', () => {
    const session = makeSession({ managerRole: 'leader' });
    expect(isLeaderSameCompany(session, 'co-1')).toBe(false);
  });

  it('false for non-leader manager even with matching companyId', () => {
    const session = makeSession({ companyId: 'co-1' });
    expect(isLeaderSameCompany(session, 'co-1')).toBe(false);
  });
});
