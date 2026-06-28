import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueUser, findManyManagedOrgs, findManyMemberships, compare, signToken } = vi.hoisted(() => ({
  findUniqueUser: vi.fn(),
  findManyManagedOrgs: vi.fn(),
  findManyMemberships: vi.fn(),
  compare: vi.fn(),
  signToken: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: findUniqueUser },
    partnerUser: { findUnique: vi.fn().mockResolvedValue(null) },
    organizationUser: { findMany: findManyMemberships },
    organizationManager: { findMany: findManyManagedOrgs }
  }
}));
vi.mock('bcryptjs', () => ({ default: { compare } }));
vi.mock('@/lib/auth/jwt', () => ({ signToken }));

import { POST } from '@/app/api/auth/login/route';

describe('auth login route — manager managedOrgIds', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('signed-token');
  });

  function managerUser(overrides?: Partial<Record<string, unknown>>) {
    return {
      id: 'u-mgr-1',
      role: 'manager',
      companyId: null,
      partnerId: null,
      organizationId: null,
      email: 'mgr@example.com',
      name: 'Manager User',
      externalStudentId: null,
      passwordHash: 'hash',
      managerRole: null,
      ...overrides
    };
  }

  function loginRequest(email = 'mgr@example.com') {
    return new Request('https://app.local/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'pw' }),
      headers: { 'content-type': 'application/json' }
    });
  }

  it('allows manager login with empty managedOrgIds when no assignments exist', async () => {
    findUniqueUser.mockResolvedValue(managerUser());
    findManyManagedOrgs.mockResolvedValue([]);

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u-mgr-1',
        role: 'manager',
        managedOrgIds: []
      })
    );
  });

  it('includes all active organizationIds in managedOrgIds', async () => {
    findUniqueUser.mockResolvedValue(managerUser());
    findManyManagedOrgs.mockResolvedValue([
      { organizationId: 'org-A' },
      { organizationId: 'org-B' }
    ]);

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    expect(findManyManagedOrgs).toHaveBeenCalledWith({
      where: { userId: 'u-mgr-1', isActive: true },
      select: { organizationId: true }
    });
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u-mgr-1',
        role: 'manager',
        managedOrgIds: ['org-A', 'org-B']
      })
    );
  });

  it('filters by isActive=true at the query level (only active rows returned)', async () => {
    // Prisma's where:{isActive:true} filter excludes deactivated rows;
    // the mock returns only the active row to simulate that behavior.
    findUniqueUser.mockResolvedValue(managerUser());
    findManyManagedOrgs.mockResolvedValue([{ organizationId: 'org-active' }]);

    await POST(loginRequest());

    expect(findManyManagedOrgs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u-mgr-1', isActive: true }
      })
    );
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        managedOrgIds: ['org-active']
      })
    );
  });

  it('does not include managedOrgIds for non-manager users', async () => {
    findUniqueUser.mockResolvedValue({
      ...managerUser(),
      id: 'u-admin',
      role: 'admin',
      email: 'admin@example.com'
    });

    await POST(loginRequest('admin@example.com'));

    expect(findManyManagedOrgs).not.toHaveBeenCalled();
    const callArg = signToken.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg).toBeDefined();
    expect(callArg).not.toHaveProperty('managedOrgIds');
  });

  it('passes managerRole: "leader" to signToken when user.managerRole is "leader"', async () => {
    findUniqueUser.mockResolvedValue(managerUser({ managerRole: 'leader' }));
    findManyManagedOrgs.mockResolvedValue([{ organizationId: 'org-A' }]);

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u-mgr-1',
        role: 'manager',
        managedOrgIds: ['org-A'],
        managerRole: 'leader'
      })
    );
  });

  it('still signs and includes managedOrgIds when user.managerRole is null (non-leader manager)', async () => {
    findUniqueUser.mockResolvedValue(managerUser({ managerRole: null }));
    findManyManagedOrgs.mockResolvedValue([{ organizationId: 'org-B' }]);

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    // signToken must not throw — response is 200
    expect(signToken).toHaveBeenCalled();
    const callArg = signToken.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg).toBeDefined();
    expect(callArg).toHaveProperty('managedOrgIds', ['org-B']);
    // managerRole: null is passed through (spreading conditional keeps it)
    expect(callArg).toHaveProperty('managerRole', null);
  });
});
