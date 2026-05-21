import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/team', () => ({
  listTeam: vi.fn(), inviteMember: vi.fn(), assignOrgs: vi.fn(), deactivateMember: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    auditLog: { create: vi.fn().mockResolvedValue(undefined) }
  }
}));

import { getSession } from '@/lib/auth/session';
import { listTeam, inviteMember, assignOrgs, deactivateMember } from '@/lib/services/partner/team';
import { GET, POST } from '@/app/api/partner/team/route';
import { PUT, DELETE } from '@/app/api/partner/team/[userId]/route';

const adminSession = {
  sub: 'u-admin', role: 'partner', partnerId: 'p1', partnerRole: 'admin', assignedOrgIds: []
} as any;

const managerSession = {
  sub: 'u-mgr', role: 'partner', partnerId: 'p1', partnerRole: 'manager', assignedOrgIds: []
} as any;

const userCtx = (userId: string) => ({ params: Promise.resolve({ userId }) });
const jsonReq = (b: unknown) => new Request('http://x/', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });

describe('GET /api/partner/team', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 for non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await GET()).status).toBe(403);
  });

  it('returns team rows for admin', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(listTeam).mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(listTeam).toHaveBeenCalledWith(expect.anything(), 'p1');
  });
});

describe('POST /api/partner/team', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 for non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await POST(jsonReq({ email: 'x@x.local', name: 'X', roleInPartner: 'manager', assignedOrgIds: [] }))).status).toBe(403);
  });

  it('400 on invalid payload', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    expect((await POST(jsonReq({ email: 'bad-email', name: '', roleInPartner: 'wrong' }))).status).toBe(400);
  });

  it('201 on success', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockResolvedValue({ user: { id: 'u1' }, partnerUser: { id: 'pu1' } } as any);

    const res = await POST(jsonReq({ email: 'x@x.local', name: 'Имя', roleInPartner: 'manager', assignedOrgIds: ['oA'] }));
    expect(res.status).toBe(201);
    expect(inviteMember).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1', email: 'x@x.local', name: 'Имя', roleInPartner: 'manager', assignedOrgIds: ['oA']
    });
  });

  it('409 on EMAIL_TAKEN', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockRejectedValue(new Error('EMAIL_TAKEN: ...'));
    expect((await POST(jsonReq({ email: 'x@x.local', name: 'И', roleInPartner: 'manager', assignedOrgIds: [] }))).status).toBe(409);
  });

  it('422 on ORG_OUT_OF_SCOPE', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockRejectedValue(new Error('ORG_OUT_OF_SCOPE'));
    expect((await POST(jsonReq({ email: 'x@x.local', name: 'И', roleInPartner: 'manager', assignedOrgIds: ['bad'] }))).status).toBe(422);
  });
});

describe('PUT /api/partner/team/[userId]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await PUT(jsonReq({ assignedOrgIds: [] }), userCtx('u'))).status).toBe(403);
  });

  it('200 on successful assignOrgs', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(assignOrgs).mockResolvedValue({} as any);

    const res = await PUT(jsonReq({ assignedOrgIds: ['oA', 'oB'] }), userCtx('user-1'));
    expect(res.status).toBe(200);
    expect(assignOrgs).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1', userId: 'user-1', assignedOrgIds: ['oA', 'oB']
    });
  });
});

describe('DELETE /api/partner/team/[userId]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await DELETE(new Request('http://x/'), userCtx('u'))).status).toBe(403);
  });

  it('204 on deactivate', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(deactivateMember).mockResolvedValue({} as any);

    expect((await DELETE(new Request('http://x/'), userCtx('user-1'))).status).toBe(204);
  });

  it('409 on LAST_ADMIN', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(deactivateMember).mockRejectedValue(new Error('LAST_ADMIN'));
    expect((await DELETE(new Request('http://x/'), userCtx('user-1'))).status).toBe(409);
  });
});
