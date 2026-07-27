import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, userUpdate, compare, signToken, partnerUserFindUnique, orgUserFindMany, orgManagerFindMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  // Этап 9 (ФТ-11.3): роут отмечает вход через prisma.user.update — без мока
  // роут падал бы на TypeError.
  userUpdate: vi.fn(),
  compare: vi.fn(),
  signToken: vi.fn(),
  partnerUserFindUnique: vi.fn(),
  orgUserFindMany: vi.fn(),
  orgManagerFindMany: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique, update: userUpdate },
    partnerUser: { findUnique: partnerUserFindUnique },
    organizationUser: { findMany: orgUserFindMany },
    organizationManager: { findMany: orgManagerFindMany }
  }
}));
vi.mock('bcryptjs', () => ({ default: { compare } }));
vi.mock('@/lib/auth/jwt', () => ({ signToken }));

import { POST } from '@/app/api/auth/login/route';

// Each test uses a unique IP to avoid hitting the in-memory rate-limit map
// (which persists across tests within the same module instance).
let ipCounter = 100;
function makeReq(body: object, ip = `10.1.${Math.floor(ipCounter / 256)}.${(ipCounter++) % 256}`) {
  return new Request('https://app.local/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }
  });
}

describe('auth login route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userUpdate.mockResolvedValue({});
  });

  it('returns 400 for invalid JSON payload (no IP headers → unknown fallback covers L43 ?? branch)', async () => {
    // No x-forwarded-for AND no x-real-ip → clientIp returns 'unknown' → covers the ?? 'unknown' branch
    const res = await POST(new Request('https://app.local/api/auth/login', {
      method: 'POST',
      body: '{bad-json',
      headers: { 'content-type': 'application/json' }
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      code: 'INVALID_REQUEST',
      message: 'Invalid request'
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 for empty fields (x-real-ip fallback covers L43 x-real-ip branch)', async () => {
    // Uses x-real-ip only (no x-forwarded-for) → covers the x-real-ip path
    const res = await POST(new Request('https://app.local/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: '', password: '' }),
      headers: { 'content-type': 'application/json', 'x-real-ip': '10.2.3.4' }
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      code: 'INVALID_REQUEST',
      message: 'Invalid request'
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns 403 with account_not_activated when passwordHash is null', async () => {
    findUnique.mockResolvedValue({
      id: 'u2',
      role: 'partner',
      companyId: null,
      partnerId: null,
      organizationId: null,
      email: 'invited@example.com',
      name: 'Invited User',
      externalStudentId: null,
      passwordHash: null
    });

    const res = await POST(makeReq({ email: 'invited@example.com', password: 'anything' }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      code: 'ACCOUNT_NOT_ACTIVATED',
      message: 'Activate your account via the invite link.'
    });
    expect(compare).not.toHaveBeenCalled();
    expect(signToken).not.toHaveBeenCalled();
  });

  it('returns 401 for unknown user (user not found)', async () => {
    findUnique.mockResolvedValue(null);
    compare.mockResolvedValue(false);

    const res = await POST(makeReq({ email: 'nobody@example.com', password: 'wrong' }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid credentials'
    });
    expect(signToken).not.toHaveBeenCalled();
  });

  it('returns 401 for wrong password (user exists but bcrypt compare returns false)', async () => {
    findUnique.mockResolvedValue({
      id: 'u1', role: 'admin', companyId: null, partnerId: null,
      organizationId: null, email: 'user@example.com', name: 'User',
      externalStudentId: null, passwordHash: 'hash'
    });
    compare.mockResolvedValue(false);

    const res = await POST(makeReq({ email: 'user@example.com', password: 'wrong' }));

    expect(res.status).toBe(401);
    expect(signToken).not.toHaveBeenCalled();
  });

  it('returns 200 and sets cookie for valid credentials', async () => {
    findUnique.mockResolvedValue({
      id: 'u1',
      role: 'admin',
      companyId: 'c1',
      partnerId: null,
      organizationId: null,
      email: 'user@example.com',
      name: 'User',
      externalStudentId: null,
      passwordHash: 'hash',
      managerRole: null
    });
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('signed-token');
    partnerUserFindUnique.mockResolvedValue(null);
    orgUserFindMany.mockResolvedValue([]);
    orgManagerFindMany.mockResolvedValue([]);

    const res = await POST(makeReq({ email: 'user@example.com', password: 'secret' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'user@example.com' } });
    expect(compare).toHaveBeenCalledWith('secret', 'hash');
    expect(signToken).toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toContain('session=signed-token');
  });

  it('200 for partner with active admin membership (covers L89 && branch + L145/L146 spread ternaries)', async () => {
    findUnique.mockResolvedValue({
      id: 'u2', role: 'partner', companyId: null, partnerId: 'p1',
      organizationId: null, email: 'partner@example.com', name: 'Partner',
      externalStudentId: null, passwordHash: 'hash', managerRole: null
    });
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('signed-token');
    partnerUserFindUnique.mockResolvedValue({
      isActive: true,
      roleInPartner: 'admin',
      assignedOrgIds: ['org1']
    });

    const res = await POST(makeReq({ email: 'partner@example.com', password: 'secret' }));

    expect(res.status).toBe(200);
    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({ partnerRole: 'admin', assignedOrgIds: ['org1'] }));
  });

  it('200 for partner with active manager membership (covers L98 manager branch)', async () => {
    findUnique.mockResolvedValue({
      id: 'u2b', role: 'partner', companyId: null, partnerId: 'p1',
      organizationId: null, email: 'partner-mgr@example.com', name: 'Partner Manager',
      externalStudentId: null, passwordHash: 'hash', managerRole: null
    });
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('signed-token');
    // roleInPartner is NOT 'admin' → ternary takes 'manager' branch
    partnerUserFindUnique.mockResolvedValue({
      isActive: true,
      roleInPartner: 'manager',
      assignedOrgIds: []
    });

    const res = await POST(makeReq({ email: 'partner-mgr@example.com', password: 'secret' }));

    expect(res.status).toBe(200);
    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({ partnerRole: 'manager' }));
  });

  it('403 for partner with deactivated membership (covers !membership.isActive branch)', async () => {
    findUnique.mockResolvedValue({
      id: 'u2', role: 'partner', companyId: null, partnerId: 'p1',
      organizationId: null, email: 'partner@example.com', name: 'Partner',
      externalStudentId: null, passwordHash: 'hash', managerRole: null
    });
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('tok');
    partnerUserFindUnique.mockResolvedValue({ isActive: false, roleInPartner: 'manager', assignedOrgIds: [] });

    const res = await POST(makeReq({ email: 'partner@example.com', password: 'secret' }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });
  });

  it('200 for partner with null partnerId (L89 short-circuit: partnerId=null branch)', async () => {
    findUnique.mockResolvedValue({
      id: 'u3', role: 'partner', companyId: null, partnerId: null,
      organizationId: null, email: 'nopartner@example.com', name: 'No Partner',
      externalStudentId: null, passwordHash: 'hash', managerRole: null
    });
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('tok');

    const res = await POST(makeReq({ email: 'nopartner@example.com', password: 'secret' }));

    expect(res.status).toBe(200);
  });

  it('200 for organization user (covers L105 if-taken branch + L147 spread ternary)', async () => {
    findUnique.mockResolvedValue({
      id: 'u4', role: 'organization', companyId: null, partnerId: null,
      organizationId: 'org1', email: 'org@example.com', name: 'Org User',
      externalStudentId: null, passwordHash: 'hash', managerRole: null
    });
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('tok');
    orgUserFindMany.mockResolvedValue([
      { organizationId: 'org1', roleInOrg: 'admin', isActive: true },
      { organizationId: 'org2', roleInOrg: 'leader', isActive: true },
      { organizationId: 'org3', roleInOrg: 'member', isActive: true }
    ]);

    const res = await POST(makeReq({ email: 'org@example.com', password: 'secret' }));

    expect(res.status).toBe(200);
    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({
      organizationMemberships: expect.arrayContaining([
        expect.objectContaining({ roleInOrg: 'admin' }),
        expect.objectContaining({ roleInOrg: 'leader' }),
        expect.objectContaining({ roleInOrg: 'member' })
      ])
    }));
  });

  it('200 for manager user (covers L124 if-taken branch + L148/L149 spread ternaries)', async () => {
    findUnique.mockResolvedValue({
      id: 'u5', role: 'manager', companyId: 'c1', partnerId: null,
      organizationId: null, email: 'mgr@example.com', name: 'Manager',
      externalStudentId: null, passwordHash: 'hash', managerRole: 'leader'
    });
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('tok');
    orgManagerFindMany.mockResolvedValue([{ organizationId: 'org1' }]);

    const res = await POST(makeReq({ email: 'mgr@example.com', password: 'secret' }));

    expect(res.status).toBe(200);
    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({
      managedOrgIds: ['org1'],
      managerRole: 'leader'
    }));
  });

  it('200 for manager user with managerRole=null (covers L133 null branch)', async () => {
    findUnique.mockResolvedValue({
      id: 'u6', role: 'manager', companyId: 'c1', partnerId: null,
      organizationId: null, email: 'mgr2@example.com', name: 'Manager2',
      externalStudentId: null, passwordHash: 'hash', managerRole: null
    });
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('tok');
    orgManagerFindMany.mockResolvedValue([]);

    const res = await POST(makeReq({ email: 'mgr2@example.com', password: 'secret' }));

    expect(res.status).toBe(200);
    // managerRole=null → managerRole !== undefined is true → spread { managerRole: null }
    expect(signToken).toHaveBeenCalledWith(expect.objectContaining({ managerRole: null }));
  });
});
