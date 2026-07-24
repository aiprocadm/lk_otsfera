import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/team', () => ({
  listTeam: vi.fn(), inviteMember: vi.fn(), assignOrgs: vi.fn(), deactivateMember: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    auditLog: { create: vi.fn().mockResolvedValue(undefined) },
    partner: { findUnique: vi.fn() }
  }
}));
vi.mock('@/lib/email/send', () => ({ sendPartnerInviteEmail: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { sendPartnerInviteEmail } from '@/lib/email/send';
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

describe('GET /api/partner/team — unauthenticated', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
});

describe('POST /api/partner/team — JSON parse failure', () => {
  beforeEach(() => vi.resetAllMocks());

  it('400 when JSON body cannot be parsed', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const badReq = new Request('http://x/', { method: 'POST', body: 'NOT JSON', headers: { 'content-type': 'application/json' } });
    expect((await POST(badReq)).status).toBe(400);
  });

  it('401 when POST unauthenticated (session is null)', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(jsonReq({ email: 'x@x.local', name: 'X', roleInPartner: 'manager', assignedOrgIds: [] }));
    expect(res.status).toBe(401);
  });
});

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

  it('400 on invalid payload — body is the bare stable code, no zod details (R2)', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const res = await POST(jsonReq({ email: 'bad-email', name: '', roleInPartner: 'wrong' }));
    expect(res.status).toBe(400);
    // Пиннинг R2-контракта: схема (имена полей/enum'ы) не эхуется клиенту.
    expect(await res.json()).toEqual({ error: 'Invalid payload' });
  });

  it('201 on success — тело содержит inviteUrl и emailStatus:sent, письмо ушло с roleLabel «менеджер»', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockResolvedValue({
      ok: true, user: { id: 'u1' }, partnerUser: { id: 'pu1' }, inviteUrl: 'https://app/reset-password?token=t1'
    } as any);
    vi.mocked(prisma.partner.findUnique).mockResolvedValue({ name: 'ООО Партнёр' } as any);
    vi.mocked(sendPartnerInviteEmail).mockResolvedValue({ status: 'sent', id: 'em-1' });

    const res = await POST(jsonReq({ email: 'x@x.local', name: 'Имя', roleInPartner: 'manager', assignedOrgIds: ['oA'] }));
    expect(res.status).toBe(201);
    expect(inviteMember).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1', email: 'x@x.local', name: 'Имя', roleInPartner: 'manager', assignedOrgIds: ['oA']
    });
    expect(await res.json()).toEqual({
      userId: 'u1',
      partnerUserId: 'pu1',
      inviteUrl: 'https://app/reset-password?token=t1',
      emailStatus: 'sent'
    });
    expect(sendPartnerInviteEmail).toHaveBeenCalledWith({
      to: 'x@x.local',
      partnerName: 'ООО Партнёр',
      roleLabel: 'менеджер',
      inviteUrl: 'https://app/reset-password?token=t1',
      invitedByName: undefined
    });
  });

  it('roleInPartner=admin → roleLabel «администратор»; без имени партнёра — фолбэк «партнёр»', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockResolvedValue({
      ok: true, user: { id: 'u1' }, partnerUser: { id: 'pu1' }, inviteUrl: 'https://app/reset-password?token=t2'
    } as any);
    vi.mocked(prisma.partner.findUnique).mockResolvedValue(null);
    vi.mocked(sendPartnerInviteEmail).mockResolvedValue({ status: 'sent', id: null });

    const res = await POST(jsonReq({ email: 'a@x.local', name: 'Админ', roleInPartner: 'admin', assignedOrgIds: [] }));
    expect(res.status).toBe(201);
    expect(sendPartnerInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ roleLabel: 'администратор', partnerName: 'партнёр' })
    );
  });

  it('email skipped (транспорт выключен) → 201 c emailStatus:skipped', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockResolvedValue({
      ok: true, user: { id: 'u1' }, partnerUser: { id: 'pu1' }, inviteUrl: 'https://app/reset-password?token=t3'
    } as any);
    vi.mocked(prisma.partner.findUnique).mockResolvedValue({ name: 'П' } as any);
    vi.mocked(sendPartnerInviteEmail).mockResolvedValue({ status: 'skipped', reason: 'disabled' });

    const res = await POST(jsonReq({ email: 'x@x.local', name: 'И', roleInPartner: 'manager', assignedOrgIds: [] }));
    expect(res.status).toBe(201);
    expect((await res.json()).emailStatus).toBe('skipped');
  });

  it('сбой отправки письма best-effort: 201 не ломается, emailStatus:skipped, inviteUrl остаётся', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockResolvedValue({
      ok: true, user: { id: 'u1' }, partnerUser: { id: 'pu1' }, inviteUrl: 'https://app/reset-password?token=t4'
    } as any);
    vi.mocked(prisma.partner.findUnique).mockResolvedValue({ name: 'П' } as any);
    vi.mocked(sendPartnerInviteEmail).mockRejectedValue(new Error('SMTP down'));

    const res = await POST(jsonReq({ email: 'x@x.local', name: 'И', roleInPartner: 'manager', assignedOrgIds: [] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      inviteUrl: 'https://app/reset-password?token=t4',
      emailStatus: 'skipped'
    });
  });

  it('409 on email_taken', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockResolvedValue({ ok: false, error: 'email_taken' } as any);
    const res = await POST(jsonReq({ email: 'x@x.local', name: 'И', roleInPartner: 'manager', assignedOrgIds: [] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'email_taken' });
  });

  it('422 on org_out_of_scope', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockResolvedValue({ ok: false, error: 'org_out_of_scope' } as any);
    const res = await POST(jsonReq({ email: 'x@x.local', name: 'И', roleInPartner: 'manager', assignedOrgIds: ['bad'] }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'org_out_of_scope' });
  });

  it('propagates unexpected errors from inviteMember', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(inviteMember).mockRejectedValue(new Error('DB_DEADLOCK: timeout'));
    await expect(POST(jsonReq({ email: 'x@x.local', name: 'И', roleInPartner: 'manager', assignedOrgIds: [] }))).rejects.toThrow('DB_DEADLOCK');
  });
});

describe('PUT /api/partner/team/[userId]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PUT(jsonReq({ assignedOrgIds: [] }), userCtx('u'))).status).toBe(401);
  });

  it('403 non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await PUT(jsonReq({ assignedOrgIds: [] }), userCtx('u'))).status).toBe(403);
  });

  it('400 on invalid payload (missing assignedOrgIds) — no zod details in body (R2)', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const req = new Request('http://x/', { method: 'PUT', body: JSON.stringify({ wrong: 'field' }), headers: { 'content-type': 'application/json' } });
    const res = await PUT(req, userCtx('u'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid payload' });
  });

  it('400 on JSON parse failure', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    const req = new Request('http://x/', { method: 'PUT', body: 'not-json', headers: { 'content-type': 'text/plain' } });
    expect((await PUT(req, userCtx('u'))).status).toBe(400);
  });

  it('200 on successful assignOrgs', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(assignOrgs).mockResolvedValue({ ok: true, partnerUser: { id: 'pu1' } } as any);

    const res = await PUT(jsonReq({ assignedOrgIds: ['oA', 'oB'] }), userCtx('user-1'));
    expect(res.status).toBe(200);
    expect(assignOrgs).toHaveBeenCalledWith(expect.anything(), {
      partnerId: 'p1', userId: 'user-1', assignedOrgIds: ['oA', 'oB']
    });
  });

  it('422 on org_out_of_scope from assignOrgs', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(assignOrgs).mockResolvedValue({ ok: false, error: 'org_out_of_scope' } as any);
    const res = await PUT(jsonReq({ assignedOrgIds: ['bad'] }), userCtx('u'));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'org_out_of_scope' });
  });

  it('propagates unexpected errors from assignOrgs', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(assignOrgs).mockRejectedValue(new Error('DB_DEADLOCK: timeout'));
    await expect(PUT(jsonReq({ assignedOrgIds: [] }), userCtx('u'))).rejects.toThrow('DB_DEADLOCK');
  });
});

describe('DELETE /api/partner/team/[userId]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await DELETE(new Request('http://x/'), userCtx('u'))).status).toBe(401);
  });

  it('403 non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(managerSession);
    expect((await DELETE(new Request('http://x/'), userCtx('u'))).status).toBe(403);
  });

  it('204 on deactivate', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(deactivateMember).mockResolvedValue({ ok: true, partnerUser: { id: 'pu1' } } as any);

    expect((await DELETE(new Request('http://x/'), userCtx('user-1'))).status).toBe(204);
  });

  it('409 on last_admin_protected', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(deactivateMember).mockResolvedValue({ ok: false, error: 'last_admin_protected' } as any);
    const res = await DELETE(new Request('http://x/'), userCtx('user-1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'last_admin_protected' });
  });

  it('404 when user not found in deactivate', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(deactivateMember).mockResolvedValue({ ok: false, error: 'not_found' } as any);
    const res = await DELETE(new Request('http://x/'), userCtx('u'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('propagates unexpected errors from deactivateMember', async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(deactivateMember).mockRejectedValue(new Error('DB_DEADLOCK: timeout'));
    await expect(DELETE(new Request('http://x/'), userCtx('u'))).rejects.toThrow('DB_DEADLOCK');
  });
});
