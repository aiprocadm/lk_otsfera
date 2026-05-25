import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn()
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({ redirect }));

import { requireOrganization, requireOrganizationAdmin } from '@/lib/auth/requireRole';
import type { SessionPayload } from '@/lib/auth/jwt';

const ORG_MEMBER: SessionPayload = {
  sub: 'u-1',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'member', isActive: true }]
};

const ORG_ADMIN_A: SessionPayload = {
  sub: 'u-2',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'org-A', roleInOrg: 'admin', isActive: true }]
};

const ORG_MULTI: SessionPayload = {
  sub: 'u-3',
  role: 'organization',
  organizationMemberships: [
    { organizationId: 'org-A', roleInOrg: 'admin', isActive: true },
    { organizationId: 'org-B', roleInOrg: 'member', isActive: true }
  ]
};

const ORG_DEACTIVATED: SessionPayload = {
  sub: 'u-4',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'org-1', roleInOrg: 'admin', isActive: false }]
};

const ORG_NO_MEMBERSHIPS: SessionPayload = {
  sub: 'u-5',
  role: 'organization'
};

const PARTNER_SESSION: SessionPayload = { sub: 'u-6', role: 'partner', partnerRole: 'admin' };

describe('requireOrganization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns session for organization user with active membership', async () => {
    getSession.mockResolvedValue(ORG_MEMBER);
    const result = await requireOrganization();
    expect(result).toEqual(ORG_MEMBER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden when role !== organization', async () => {
    getSession.mockResolvedValue(PARTNER_SESSION);
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(requireOrganization()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden when memberships missing', async () => {
    getSession.mockResolvedValue(ORG_NO_MEMBERSHIPS);
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(requireOrganization()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden when all memberships deactivated', async () => {
    getSession.mockResolvedValue(ORG_DEACTIVATED);
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(requireOrganization()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /login when session is null', async () => {
    getSession.mockResolvedValue(null);
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(requireOrganization()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});

describe('requireOrganizationAdmin', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns session for admin in any org when orgId not specified', async () => {
    getSession.mockResolvedValue(ORG_ADMIN_A);
    const result = await requireOrganizationAdmin();
    expect(result).toEqual(ORG_ADMIN_A);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('returns session for admin of requested org', async () => {
    getSession.mockResolvedValue(ORG_ADMIN_A);
    const result = await requireOrganizationAdmin('org-A');
    expect(result).toEqual(ORG_ADMIN_A);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden for member in requested org', async () => {
    getSession.mockResolvedValue(ORG_MEMBER);
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(requireOrganizationAdmin('org-1')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden when admin in another org but not requested', async () => {
    getSession.mockResolvedValue(ORG_ADMIN_A);
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(requireOrganizationAdmin('org-other')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });

  it('returns session for multi-org user requesting admin org', async () => {
    getSession.mockResolvedValue(ORG_MULTI);
    const result = await requireOrganizationAdmin('org-A');
    expect(result).toEqual(ORG_MULTI);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden for multi-org user requesting member-only org', async () => {
    getSession.mockResolvedValue(ORG_MULTI);
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(requireOrganizationAdmin('org-B')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/forbidden');
  });
});
