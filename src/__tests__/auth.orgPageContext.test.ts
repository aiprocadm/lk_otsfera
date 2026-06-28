import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any import that could trigger them
// ---------------------------------------------------------------------------

const {
  requireOrganization,
  cookiesFn,
  cookiesGet,
  resolveActiveOrgId,
  activeOrgIds,
  isOrgAdmin,
  isOrgLeader,
  orgFindMany,
  orgUserFindFirst
} = vi.hoisted(() => {
  const cookiesGet = vi.fn();
  const cookiesFn = vi.fn(async () => ({ get: cookiesGet }));
  return {
    requireOrganization: vi.fn(),
    cookiesFn,
    cookiesGet,
    resolveActiveOrgId: vi.fn(),
    activeOrgIds: vi.fn(),
    isOrgAdmin: vi.fn(),
    isOrgLeader: vi.fn(),
    orgFindMany: vi.fn(),
    orgUserFindFirst: vi.fn()
  };
});

vi.mock('@/lib/auth/requireRole', () => ({
  requireOrganization
}));

vi.mock('next/headers', () => ({
  cookies: cookiesFn
}));

vi.mock('@/lib/auth/orgContext', () => ({
  resolveActiveOrgId
}));

vi.mock('@/lib/auth/organizationPolicy', () => ({
  activeOrgIds,
  isOrgAdmin,
  isOrgLeader
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findMany: orgFindMany },
    organizationUser: { findFirst: orgUserFindFirst }
  }
}));

// ---------------------------------------------------------------------------
// Imports under test (must come after vi.mock calls)
// ---------------------------------------------------------------------------

import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import type { SessionPayload } from '@/lib/auth/jwt';

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const BASE_ORG_SESSION: SessionPayload = {
  sub: 'u-org-1',
  role: 'organization',
  organizationMemberships: [
    { organizationId: 'org-A', roleInOrg: 'admin', isActive: true },
    { organizationId: 'org-B', roleInOrg: 'leader', isActive: true },
    { organizationId: 'org-C', roleInOrg: 'member', isActive: false } // inactive
  ]
};

// ---------------------------------------------------------------------------
// getOrgPageContext
// ---------------------------------------------------------------------------

describe('getOrgPageContext', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireOrganization.mockResolvedValue(BASE_ORG_SESSION);
    // Restore cookies mock after resetAllMocks clears it
    cookiesFn.mockImplementation(async () => ({ get: cookiesGet }));
    cookiesGet.mockReturnValue(undefined); // no cookie by default
    resolveActiveOrgId.mockReturnValue('org-A');
    activeOrgIds.mockReturnValue(['org-A', 'org-B']);
    orgFindMany.mockResolvedValue([
      { id: 'org-A', name: 'Alpha Corp' },
      { id: 'org-B', name: 'Beta Ltd' }
    ]);
    isOrgAdmin.mockReturnValue(false);
    isOrgLeader.mockReturnValue(false);
  });

  // --- Happy path: member role (both isOrgAdmin and isOrgLeader return false) ---
  it('returns OrgPageContext with viewerRole=member when user is a plain member', async () => {
    isOrgAdmin.mockReturnValue(false);
    isOrgLeader.mockReturnValue(false);

    const ctx = await getOrgPageContext();

    expect(ctx.session).toEqual(BASE_ORG_SESSION);
    expect(ctx.activeOrgId).toBe('org-A');
    expect(ctx.activeOrgName).toBe('Alpha Corp');
    expect(ctx.viewerRole).toBe('member');
    expect(ctx.memberships).toHaveLength(2); // only active ones
    expect(ctx.memberships[0]).toEqual({
      organizationId: 'org-A',
      organizationName: 'Alpha Corp',
      roleInOrg: 'admin'
    });
    expect(ctx.memberships[1]).toEqual({
      organizationId: 'org-B',
      organizationName: 'Beta Ltd',
      roleInOrg: 'leader'
    });
  });

  // --- viewerRole=admin branch ---
  it('returns viewerRole=admin when isOrgAdmin returns true', async () => {
    isOrgAdmin.mockReturnValue(true);
    isOrgLeader.mockReturnValue(false);

    const ctx = await getOrgPageContext();

    expect(ctx.viewerRole).toBe('admin');
    // isOrgAdmin called with session + activeOrgId
    expect(isOrgAdmin).toHaveBeenCalledWith(BASE_ORG_SESSION, 'org-A');
  });

  // --- viewerRole=leader branch (isOrgAdmin=false, isOrgLeader=true) ---
  it('returns viewerRole=leader when isOrgAdmin=false but isOrgLeader=true', async () => {
    isOrgAdmin.mockReturnValue(false);
    isOrgLeader.mockReturnValue(true);

    const ctx = await getOrgPageContext();

    expect(ctx.viewerRole).toBe('leader');
    expect(isOrgLeader).toHaveBeenCalledWith(BASE_ORG_SESSION, 'org-A');
  });

  // --- activeOrgName falls back to '—' when org not in DB result ---
  it("falls back to '—' for activeOrgName when org not returned from DB", async () => {
    orgFindMany.mockResolvedValue([]); // no orgs returned
    resolveActiveOrgId.mockReturnValue('org-unknown');

    const ctx = await getOrgPageContext();

    expect(ctx.activeOrgName).toBe('—');
  });

  // --- membership name falls back to '—' when not in DB result ---
  it("sets organizationName to '—' for memberships whose org is missing from DB", async () => {
    orgFindMany.mockResolvedValue([]); // empty — nothing in nameById

    const ctx = await getOrgPageContext();

    // Both active memberships should get '—' as name
    expect(ctx.memberships[0].organizationName).toBe('—');
    expect(ctx.memberships[1].organizationName).toBe('—');
  });

  // --- searchParams.org as string is passed to resolveActiveOrgId ---
  it('passes string searchParams.org as queryOrg to resolveActiveOrgId', async () => {
    await getOrgPageContext({ org: 'org-B' });

    expect(resolveActiveOrgId).toHaveBeenCalledWith(BASE_ORG_SESSION, 'org-B', null);
  });

  // --- searchParams.org as array (non-string) → queryOrg = undefined ---
  it('passes undefined queryOrg when searchParams.org is an array', async () => {
    await getOrgPageContext({ org: ['org-A', 'org-B'] });

    expect(resolveActiveOrgId).toHaveBeenCalledWith(BASE_ORG_SESSION, undefined, null);
  });

  // --- no searchParams at all ---
  it('passes undefined queryOrg when no searchParams provided', async () => {
    await getOrgPageContext();

    expect(resolveActiveOrgId).toHaveBeenCalledWith(BASE_ORG_SESSION, undefined, null);
  });

  // --- cookie value is forwarded ---
  it('reads org_ctx cookie and passes its value to resolveActiveOrgId', async () => {
    cookiesGet.mockReturnValue({ value: 'org-B' });

    await getOrgPageContext();

    expect(resolveActiveOrgId).toHaveBeenCalledWith(BASE_ORG_SESSION, undefined, 'org-B');
  });

  // --- inactive memberships are filtered out ---
  it('filters out inactive memberships from the returned memberships array', async () => {
    const ctx = await getOrgPageContext();

    const ids = ctx.memberships.map((m) => m.organizationId);
    expect(ids).not.toContain('org-C'); // org-C membership is inactive
    expect(ctx.memberships).toHaveLength(2);
  });

  // --- prisma query uses allowedIds from activeOrgIds ---
  it('queries only allowedIds from activeOrgIds', async () => {
    activeOrgIds.mockReturnValue(['org-A', 'org-B']);

    await getOrgPageContext();

    expect(orgFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['org-A', 'org-B'] } },
      select: { id: true, name: true }
    });
  });

  // --- delegation: requireOrganization is called ---
  it('delegates auth to requireOrganization', async () => {
    await getOrgPageContext();

    expect(requireOrganization).toHaveBeenCalledOnce();
  });

  // --- organizationMemberships absent in session (falls back to []) ---
  it('returns empty memberships array when session.organizationMemberships is undefined', async () => {
    const sessionNoMemberships: SessionPayload = {
      sub: 'u-org-empty',
      role: 'organization'
      // organizationMemberships absent → ?? [] fallback
    };
    requireOrganization.mockResolvedValue(sessionNoMemberships);
    activeOrgIds.mockReturnValue([]);
    resolveActiveOrgId.mockReturnValue('org-X');
    orgFindMany.mockResolvedValue([]);

    const ctx = await getOrgPageContext();

    expect(ctx.memberships).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getPrimaryOrganizationId
// ---------------------------------------------------------------------------

describe('getPrimaryOrganizationId', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const SESSION_WITH_ORG_ID: SessionPayload = {
    sub: 'u-org',
    role: 'organization',
    organizationId: 'org-direct'
  };

  const SESSION_WITHOUT_ORG_ID: SessionPayload = {
    sub: 'u-org-2',
    role: 'organization'
    // no organizationId
  };

  // --- Happy path: organizationId present in session ---
  it('returns session.organizationId immediately when present', async () => {
    const result = await getPrimaryOrganizationId(SESSION_WITH_ORG_ID);

    expect(result).toBe('org-direct');
    // Should short-circuit without querying DB
    expect(orgUserFindFirst).not.toHaveBeenCalled();
  });

  // --- Falls through to DB when organizationId absent, membership found ---
  it('queries OrganizationUser and returns organizationId when membership exists', async () => {
    orgUserFindFirst.mockResolvedValue({ organizationId: 'org-from-db' });

    const result = await getPrimaryOrganizationId(SESSION_WITHOUT_ORG_ID);

    expect(result).toBe('org-from-db');
    expect(orgUserFindFirst).toHaveBeenCalledWith({
      where: { userId: 'u-org-2', isActive: true },
      select: { organizationId: true },
      orderBy: { createdAt: 'asc' }
    });
  });

  // --- Returns null when no membership found in DB ---
  it('returns null when no active membership exists in DB', async () => {
    orgUserFindFirst.mockResolvedValue(null);

    const result = await getPrimaryOrganizationId(SESSION_WITHOUT_ORG_ID);

    expect(result).toBeNull();
    expect(orgUserFindFirst).toHaveBeenCalledOnce();
  });

  // --- organizationId is null/falsy → falls through to DB ---
  it('falls through to DB when organizationId is null', async () => {
    const sessionNullOrg: SessionPayload = { sub: 'u-null', role: 'organization', organizationId: null };
    orgUserFindFirst.mockResolvedValue({ organizationId: 'org-via-db' });

    const result = await getPrimaryOrganizationId(sessionNullOrg);

    expect(result).toBe('org-via-db');
    expect(orgUserFindFirst).toHaveBeenCalledOnce();
  });
});
