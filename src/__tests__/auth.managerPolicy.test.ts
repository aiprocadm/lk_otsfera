import { describe, expect, it } from 'vitest';
import {
  managedOrgIds,
  managerOrderScopeFilter,
  managerDocumentScopeFilter,
  managerOrgScopeFilter,
  canSeeOrder,
  canSeeDocument,
  canSeeOrganization,
  isOrgInScope
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
