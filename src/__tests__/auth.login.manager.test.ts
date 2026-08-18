import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findUniqueUser,
  updateUser,
  findManyManagedOrgs,
  findManyMemberships,
  findUniqueAccessProfile,
  compare,
  signToken,
} = vi.hoisted(() => ({
  findUniqueUser: vi.fn(),
  updateUser: vi.fn(),
  findManyManagedOrgs: vi.fn(),
  findManyMemberships: vi.fn(),
  findUniqueAccessProfile: vi.fn(),
  compare: vi.fn(),
  signToken: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    // updateUser — отметка lastLoginAt (этап 9, ФТ-11.3)
    user: { findUnique: findUniqueUser, update: updateUser },
    partnerUser: { findUnique: vi.fn().mockResolvedValue(null) },
    organizationUser: { findMany: findManyMemberships },
    organizationManager: { findMany: findManyManagedOrgs },
    accessProfile: { findUnique: findUniqueAccessProfile },
  },
}));
vi.mock('bcryptjs', () => ({ default: { compare } }));
vi.mock('@/lib/auth/jwt', () => ({ signToken }));

import { POST } from '@/app/api/auth/login/route';

describe('auth login route — manager managedOrgIds', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('signed-token');
    findUniqueAccessProfile.mockResolvedValue(null);
    updateUser.mockResolvedValue({});
  });

  function managerUser(overrides?: Partial<Record<string, unknown>>) {
    return {
      id: 'u-mgr-1',
      role: 'manager',
      companyId: 'co-1',
      partnerId: null,
      organizationId: null,
      email: 'mgr@example.com',
      name: 'Manager User',
      externalStudentId: null,
      passwordHash: 'hash',
      ...overrides,
    };
  }

  function loginRequest(email = 'mgr@example.com') {
    return new Request('https://app.local/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'pw' }),
      headers: { 'content-type': 'application/json' },
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
        managedOrgIds: [],
      })
    );
  });

  it('includes all active organizationIds in managedOrgIds', async () => {
    findUniqueUser.mockResolvedValue(managerUser());
    findManyManagedOrgs.mockResolvedValue([
      { organizationId: 'org-A' },
      { organizationId: 'org-B' },
    ]);

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    // C8 company floor: only orgs in the manager's own company are counted.
    expect(findManyManagedOrgs).toHaveBeenCalledWith({
      where: { userId: 'u-mgr-1', isActive: true, organization: { companyId: 'co-1' } },
      select: { organizationId: true },
    });
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u-mgr-1',
        role: 'manager',
        managedOrgIds: ['org-A', 'org-B'],
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
        where: { userId: 'u-mgr-1', isActive: true, organization: { companyId: 'co-1' } },
      })
    );
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        managedOrgIds: ['org-active'],
      })
    );
  });

  it('applies the company floor: excludes orgs outside the manager company', async () => {
    // Regression (C8): a stale/legacy cross-company OrganizationManager row must
    // not widen scope. The query itself carries the company filter, so a foreign
    // org row is never returned. We assert the filter is present AND that only
    // the in-company rows the query returns end up in managedOrgIds.
    findUniqueUser.mockResolvedValue(managerUser({ companyId: 'co-1' }));
    findManyManagedOrgs.mockResolvedValue([{ organizationId: 'org-in-company' }]);

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    expect(findManyManagedOrgs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organization: { companyId: 'co-1' } }),
      })
    );
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({ managedOrgIds: ['org-in-company'] })
    );
  });

  it('a manager with no companyId gets an empty managedOrgIds (deny-null) without querying', async () => {
    // C8 deny-null: companyId=null is the "no company" sentinel; such a manager
    // must not resolve ANY managed orgs, so we skip the query entirely.
    findUniqueUser.mockResolvedValue(managerUser({ companyId: null }));

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    expect(findManyManagedOrgs).not.toHaveBeenCalled();
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'manager', managedOrgIds: [] })
    );
  });

  it('does not include managedOrgIds for non-manager users', async () => {
    findUniqueUser.mockResolvedValue({
      ...managerUser(),
      id: 'u-admin',
      role: 'admin',
      email: 'admin@example.com',
    });

    await POST(loginRequest('admin@example.com'));

    expect(findManyManagedOrgs).not.toHaveBeenCalled();
    const callArg = signToken.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg).toBeDefined();
    expect(callArg).not.toHaveProperty('managedOrgIds');
  });

  it('руководитель (role=leader) получает managedOrgIds тем же контуром (ТЗ 2026-08-17)', async () => {
    // Руководитель — самостоятельная top-level роль (PR-4 снял суб-роль
    // managerRole вместе с колонкой), но денормализация managedOrgIds для него
    // обязана работать как для менеджера: без неё requireManager() выбросит
    // руководителя на /login.
    findUniqueUser.mockResolvedValue(managerUser({ role: 'leader' }));
    findManyManagedOrgs.mockResolvedValue([{ organizationId: 'org-A' }]);

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u-mgr-1',
        role: 'leader',
        managedOrgIds: ['org-A'],
      })
    );
  });

  it('рядовой менеджер подписывается без снятого клейма managerRole (ТЗ 2026-08-17)', async () => {
    findUniqueUser.mockResolvedValue(managerUser());
    findManyManagedOrgs.mockResolvedValue([{ organizationId: 'org-B' }]);

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    // signToken must not throw — response is 200
    expect(signToken).toHaveBeenCalled();
    const callArg = signToken.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg).toBeDefined();
    expect(callArg).toHaveProperty('role', 'manager');
    expect(callArg).toHaveProperty('managedOrgIds', ['org-B']);
    // Клейм снят PR-4 — если он вернётся в сборку токена, тест упадёт.
    expect(callArg).not.toHaveProperty('managerRole');
  });

  // G1: денормализация AccessProfile в токен при логине менеджера.
  it('denormalizes AccessProfile into the token when user.accessProfileId is set', async () => {
    findUniqueUser.mockResolvedValue(managerUser({ accessProfileId: 'ap-1' }));
    findManyManagedOrgs.mockResolvedValue([{ organizationId: 'org-A' }]);
    findUniqueAccessProfile.mockResolvedValue({
      id: 'ap-1',
      name: 'Оператор',
      ordersScope: 'assigned',
      organizationsScope: 'assigned',
      threadsScope: 'assigned',
      documentsScope: 'assigned',
      financeScope: 'own',
      leadsScope: 'own',
      tasksScope: 'own',
      capabilities: ['see_commission', 'garbage'], // 'garbage' отбрасывается схемой
    });

    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    expect(findUniqueAccessProfile).toHaveBeenCalledWith({ where: { id: 'ap-1' } });
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        accessProfile: {
          id: 'ap-1',
          name: 'Оператор',
          orders: 'assigned',
          organizations: 'assigned',
          threads: 'assigned',
          documents: 'assigned',
          finance: 'own',
          leads: 'own',
          tasks: 'own',
          capabilities: ['see_commission'],
        },
      })
    );
  });

  it('omits accessProfile from token when user has no accessProfileId (legacy manager)', async () => {
    findUniqueUser.mockResolvedValue(managerUser({ accessProfileId: null }));
    findManyManagedOrgs.mockResolvedValue([]);

    await POST(loginRequest());

    expect(findUniqueAccessProfile).not.toHaveBeenCalled();
    const callArg = signToken.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg).toBeDefined();
    expect(callArg).not.toHaveProperty('accessProfile');
  });
});
