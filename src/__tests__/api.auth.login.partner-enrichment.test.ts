import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUserUnique, findPartnerUserUnique, compareFn, signTokenFn } = vi.hoisted(() => ({
  findUserUnique: vi.fn(),
  findPartnerUserUnique: vi.fn(),
  compareFn: vi.fn(),
  signTokenFn: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: findUserUnique },
    partnerUser: { findUnique: findPartnerUserUnique }
  }
}));
vi.mock('bcryptjs', () => ({ default: { compare: compareFn } }));
vi.mock('@/lib/auth/jwt', () => ({ signToken: signTokenFn }));

import { POST } from '@/app/api/auth/login/route';

const partnerUser = {
  id: 'user-1', email: 'p@test.local', passwordHash: 'hash', name: 'Партнёр',
  role: 'partner', partnerId: 'partner-1',
  companyId: null, organizationId: null, externalStudentId: null
};

function makeRequest(body: object) {
  return new Request('https://app.local/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('POST /api/auth/login partner enrichment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    compareFn.mockResolvedValue(true);
    signTokenFn.mockResolvedValue('signed-token');
  });

  it('signs JWT with partnerRole=admin and assignedOrgIds=[] for partner admin', async () => {
    findUserUnique.mockResolvedValue(partnerUser);
    findPartnerUserUnique.mockResolvedValue({
      id: 'pu-1', partnerId: 'partner-1', userId: 'user-1',
      roleInPartner: 'admin', assignedOrgIds: [], isActive: true
    });

    const res = await POST(makeRequest({ email: 'p@test.local', password: 'x' }));
    expect(res.status).toBe(200);

    expect(signTokenFn).toHaveBeenCalledWith(expect.objectContaining({
      sub: 'user-1',
      role: 'partner',
      partnerId: 'partner-1',
      partnerRole: 'admin',
      assignedOrgIds: []
    }));
  });

  it('signs JWT with partnerRole=manager and assignedOrgIds=[orgA,orgB] for scoped manager', async () => {
    findUserUnique.mockResolvedValue(partnerUser);
    findPartnerUserUnique.mockResolvedValue({
      id: 'pu-2', partnerId: 'partner-1', userId: 'user-1',
      roleInPartner: 'manager', assignedOrgIds: ['orgA', 'orgB'], isActive: true
    });

    await POST(makeRequest({ email: 'p@test.local', password: 'x' }));

    expect(signTokenFn).toHaveBeenCalledWith(expect.objectContaining({
      partnerRole: 'manager',
      assignedOrgIds: ['orgA', 'orgB']
    }));
  });

  it('omits partner sub-role fields if user has no PartnerUser record (legacy partner)', async () => {
    findUserUnique.mockResolvedValue(partnerUser);
    findPartnerUserUnique.mockResolvedValue(null);

    await POST(makeRequest({ email: 'p@test.local', password: 'x' }));

    const arg = signTokenFn.mock.calls[0][0];
    expect(arg.partnerRole).toBeUndefined();
    expect(arg.assignedOrgIds).toBeUndefined();
  });

  it('refuses login (403) if PartnerUser exists but isActive=false', async () => {
    findUserUnique.mockResolvedValue(partnerUser);
    findPartnerUserUnique.mockResolvedValue({
      id: 'pu-3', partnerId: 'partner-1', userId: 'user-1',
      roleInPartner: 'manager', assignedOrgIds: [], isActive: false
    });

    const res = await POST(makeRequest({ email: 'p@test.local', password: 'x' }));
    expect(res.status).toBe(403);
    expect(signTokenFn).not.toHaveBeenCalled();
  });

  it('does not query partnerUser if role != partner', async () => {
    findUserUnique.mockResolvedValue({ ...partnerUser, role: 'admin' });

    await POST(makeRequest({ email: 'a@test.local', password: 'x' }));

    expect(findPartnerUserUnique).not.toHaveBeenCalled();
  });

  it('does not query partnerUser if role=partner but partnerId is null (defensive)', async () => {
    findUserUnique.mockResolvedValue({ ...partnerUser, partnerId: null });

    await POST(makeRequest({ email: 'p@test.local', password: 'x' }));

    expect(findPartnerUserUnique).not.toHaveBeenCalled();
  });
});
