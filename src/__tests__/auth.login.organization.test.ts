import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueUser, updateUser, findManyMemberships, compare, signToken } = vi.hoisted(() => ({
  findUniqueUser: vi.fn(),
  updateUser: vi.fn(),
  findManyMemberships: vi.fn(),
  compare: vi.fn(),
  signToken: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    // updateUser — отметка lastLoginAt (этап 9, ФТ-11.3)
    user: { findUnique: findUniqueUser, update: updateUser },
    partnerUser: { findUnique: vi.fn().mockResolvedValue(null) },
    organizationUser: { findMany: findManyMemberships },
  },
}));
vi.mock('bcryptjs', () => ({ default: { compare } }));
vi.mock('@/lib/auth/jwt', () => ({ signToken }));

import { POST } from '@/app/api/auth/login/route';

describe('auth login route — organization memberships', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('signed-token');
    updateUser.mockResolvedValue({});
  });

  function orgUser() {
    return {
      id: 'u-org-1',
      role: 'organization',
      companyId: null,
      partnerId: null,
      organizationId: null,
      email: 'org@example.com',
      name: 'Org User',
      externalStudentId: null,
      passwordHash: 'hash',
    };
  }

  it('includes organizationMemberships in token when active memberships exist', async () => {
    findUniqueUser.mockResolvedValue(orgUser());
    findManyMemberships.mockResolvedValue([
      { organizationId: 'org-A', roleInOrg: 'admin', isActive: true },
      { organizationId: 'org-B', roleInOrg: 'member', isActive: true },
    ]);

    const res = await POST(
      new Request('https://app.local/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'org@example.com', password: 'pw' }),
        headers: { 'content-type': 'application/json' },
      })
    );

    expect(res.status).toBe(200);
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u-org-1',
        role: 'organization',
        organizationMemberships: [
          { organizationId: 'org-A', roleInOrg: 'admin', isActive: true },
          { organizationId: 'org-B', roleInOrg: 'member', isActive: true },
        ],
      })
    );
  });

  it('preserves the leader role in the signed token', async () => {
    findUniqueUser.mockResolvedValue(orgUser());
    findManyMemberships.mockResolvedValue([
      { organizationId: 'org-A', roleInOrg: 'leader', isActive: true },
    ]);

    await POST(
      new Request('https://app.local/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'org@example.com', password: 'pw' }),
        headers: { 'content-type': 'application/json' },
      })
    );

    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationMemberships: [{ organizationId: 'org-A', roleInOrg: 'leader', isActive: true }],
      })
    );
  });

  it('coerces unexpected roleInOrg values to member', async () => {
    findUniqueUser.mockResolvedValue(orgUser());
    findManyMemberships.mockResolvedValue([
      { organizationId: 'org-A', roleInOrg: 'something-weird', isActive: true },
    ]);

    await POST(
      new Request('https://app.local/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'org@example.com', password: 'pw' }),
        headers: { 'content-type': 'application/json' },
      })
    );

    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationMemberships: [{ organizationId: 'org-A', roleInOrg: 'member', isActive: true }],
      })
    );
  });

  it('passes empty organizationMemberships when role=organization but no rows (legacy)', async () => {
    findUniqueUser.mockResolvedValue(orgUser());
    findManyMemberships.mockResolvedValue([]);

    const res = await POST(
      new Request('https://app.local/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'org@example.com', password: 'pw' }),
        headers: { 'content-type': 'application/json' },
      })
    );

    expect(res.status).toBe(200);
    expect(signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationMemberships: [],
      })
    );
  });

  it('does not call organizationUser.findMany for non-organization users', async () => {
    findUniqueUser.mockResolvedValue({
      ...orgUser(),
      id: 'u-admin',
      role: 'admin',
    });

    await POST(
      new Request('https://app.local/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com', password: 'pw' }),
        headers: { 'content-type': 'application/json' },
      })
    );

    expect(findManyMemberships).not.toHaveBeenCalled();
  });
});
