import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findUniqueMock,
  updateUserMock,
  compareMock,
  isRateLimitedMock,
  isFeatureEnabledMock,
  createChallengeMock,
  discardChallengeMock,
  sendMock,
  buildClaimsMock,
  signTokenMock,
  signPendingMock,
  recordAuditMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateUserMock: vi.fn(),
  compareMock: vi.fn(),
  isRateLimitedMock: vi.fn(),
  isFeatureEnabledMock: vi.fn(),
  createChallengeMock: vi.fn(),
  discardChallengeMock: vi.fn(),
  sendMock: vi.fn(),
  buildClaimsMock: vi.fn(),
  signTokenMock: vi.fn(),
  signPendingMock: vi.fn(),
  recordAuditMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    // update — отметка lastLoginAt (этап 9, ФТ-11.3)
    user: { findUnique: findUniqueMock, update: updateUserMock },
    twoFactorChallenge: { delete: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('bcryptjs', () => ({ default: { compare: compareMock } }));
vi.mock('@/lib/rateLimit', () => ({ isRateLimited: isRateLimitedMock }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: isFeatureEnabledMock }));
vi.mock('@/lib/services/auth/twoFactor', () => ({
  createTwoFactorChallenge: createChallengeMock,
  discardTwoFactorChallenge: discardChallengeMock,
}));
vi.mock('@/lib/email/send', () => ({ send: sendMock }));
vi.mock('@/lib/auth/buildSessionClaims', () => ({ buildSessionClaims: buildClaimsMock }));
vi.mock('@/lib/auth/jwt', () => ({
  signToken: signTokenMock,
  signTwoFactorPendingToken: signPendingMock,
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { POST } from '@/app/api/auth/login/route';

const MANAGER = {
  id: 'u-mgr',
  email: 'mgr@x.ru',
  name: 'Менеджер',
  role: 'manager',
  passwordHash: 'hash',
  isActive: true,
  companyId: 'c1',
  partnerId: null,
  organizationId: null,
  externalStudentId: null,
};

function req(body: unknown): Request {
  return new Request('http://x/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateUserMock.mockResolvedValue({});
  isRateLimitedMock.mockResolvedValue(false);
  compareMock.mockResolvedValue(true);
  isFeatureEnabledMock.mockReturnValue(true);
  createChallengeMock.mockResolvedValue({ code: '123456' });
  discardChallengeMock.mockResolvedValue(undefined);
  sendMock.mockResolvedValue(undefined);
  buildClaimsMock.mockResolvedValue({ ok: true, claims: { sub: 'u-mgr', role: 'manager' } });
  signTokenMock.mockResolvedValue('session-jwt');
  signPendingMock.mockResolvedValue('pending-jwt');
  recordAuditMock.mockResolvedValue(undefined);
});

describe('POST /api/auth/login — staff 2FA branch', () => {
  it('manager + flag ON → challenge issued, pending cookie set, NO session cookie', async () => {
    findUniqueMock.mockResolvedValue(MANAGER);

    const res = await POST(req({ email: 'mgr@x.ru', password: 'pw' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, twoFactorRequired: true });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('2fa_pending=pending-jwt');
    expect(setCookie).not.toContain('session=');
    expect(createChallengeMock).toHaveBeenCalledWith(expect.anything(), 'u-mgr');
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'mgr@x.ru', subject: 'Код подтверждения входа' })
    );
    // Код присутствует в теле письма, но не в subject
    const sendArg = sendMock.mock.calls[0][0];
    expect(sendArg.text).toContain('123456');
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: '2fa_code_sent', entity: 'auth_2fa', entityId: 'u-mgr' })
    );
  });

  it('admin + flag ON → challenge issued', async () => {
    findUniqueMock.mockResolvedValue({ ...MANAGER, id: 'u-adm', role: 'admin', email: 'a@x.ru' });
    buildClaimsMock.mockResolvedValue({ ok: true, claims: { sub: 'u-adm', role: 'admin' } });

    const res = await POST(req({ email: 'a@x.ru', password: 'pw' }));

    expect(await res.json()).toEqual({ ok: true, twoFactorRequired: true });
  });

  it('leader + flag ON → challenge issued (руководитель тоже staff, ТЗ 2026-08-17)', async () => {
    findUniqueMock.mockResolvedValue({ ...MANAGER, id: 'u-ldr', role: 'leader', email: 'l@x.ru' });
    buildClaimsMock.mockResolvedValue({ ok: true, claims: { sub: 'u-ldr', role: 'leader' } });

    const res = await POST(req({ email: 'l@x.ru', password: 'pw' }));

    expect(await res.json()).toEqual({ ok: true, twoFactorRequired: true });
  });

  it('partner + flag ON → ordinary session, no challenge', async () => {
    findUniqueMock.mockResolvedValue({ ...MANAGER, id: 'u-p', role: 'partner', partnerId: 'p1' });
    buildClaimsMock.mockResolvedValue({ ok: true, claims: { sub: 'u-p', role: 'partner' } });

    const res = await POST(req({ email: 'mgr@x.ru', password: 'pw' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('set-cookie') ?? '').toContain('session=session-jwt');
    expect(createChallengeMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('manager + flag OFF → ordinary session, no challenge', async () => {
    isFeatureEnabledMock.mockReturnValue(false);
    findUniqueMock.mockResolvedValue(MANAGER);

    const res = await POST(req({ email: 'mgr@x.ru', password: 'pw' }));

    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('set-cookie') ?? '').toContain('session=session-jwt');
    expect(createChallengeMock).not.toHaveBeenCalled();
  });

  it('email send failure → 502 EMAIL_SEND_FAILED, challenge deleted, no cookies', async () => {
    findUniqueMock.mockResolvedValue(MANAGER);
    sendMock.mockRejectedValue(new Error('resend down'));

    const res = await POST(req({ email: 'mgr@x.ru', password: 'pw' }));

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('EMAIL_SEND_FAILED');
    // Челлендж снимается сервисом (сам prisma-запрос проверяется в
    // services.auth.login-flow.unit.test.ts).
    expect(discardChallengeMock).toHaveBeenCalledWith(expect.anything(), 'u-mgr');
    expect(res.headers.get('set-cookie') ?? '').not.toContain('2fa_pending=');
  });

  it('non-Error send rejection (string) → 502 (String(err) log arm)', async () => {
    findUniqueMock.mockResolvedValue(MANAGER);
    sendMock.mockRejectedValue('smtp string down');

    const res = await POST(req({ email: 'mgr@x.ru', password: 'pw' }));

    expect(res.status).toBe(502);
  });

  it('deactivated partner membership is checked BEFORE the 2FA branch (no email for deactivated)', async () => {
    findUniqueMock.mockResolvedValue(MANAGER);
    buildClaimsMock.mockResolvedValue({ ok: false, error: 'account_deactivated' });

    const res = await POST(req({ email: 'mgr@x.ru', password: 'pw' }));

    expect(res.status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
    expect(createChallengeMock).not.toHaveBeenCalled();
  });

  it('audit failure does not break the flow (best-effort)', async () => {
    findUniqueMock.mockResolvedValue(MANAGER);
    recordAuditMock.mockRejectedValue(new Error('audit down'));

    const res = await POST(req({ email: 'mgr@x.ru', password: 'pw' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, twoFactorRequired: true });
  });
});
