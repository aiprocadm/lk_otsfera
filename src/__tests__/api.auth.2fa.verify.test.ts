import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  findUniqueMock,
  notFoundIfDisabledMock,
  verifyPendingMock,
  verifyCodeMock,
  buildClaimsMock,
  signTokenMock,
  recordAuditMock,
  isRateLimitedMock
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  notFoundIfDisabledMock: vi.fn(),
  verifyPendingMock: vi.fn(),
  verifyCodeMock: vi.fn(),
  buildClaimsMock: vi.fn(),
  signTokenMock: vi.fn(),
  recordAuditMock: vi.fn(),
  isRateLimitedMock: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: findUniqueMock } } }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: notFoundIfDisabledMock }));
vi.mock('@/lib/auth/jwt', () => ({
  verifyTwoFactorPendingToken: verifyPendingMock,
  signToken: signTokenMock
}));
vi.mock('@/lib/services/auth/twoFactor', () => ({ verifyTwoFactorCode: verifyCodeMock }));
vi.mock('@/lib/auth/buildSessionClaims', () => ({ buildSessionClaims: buildClaimsMock }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/rateLimit', () => ({ isRateLimited: isRateLimitedMock }));

import { POST } from '@/app/api/auth/2fa/verify/route';

const USER = {
  id: 'u1',
  email: 'm@x.ru',
  name: 'М',
  role: 'manager',
  isActive: true,
  companyId: 'c1',
  partnerId: null,
  organizationId: null,
  externalStudentId: null
};

function req(body: unknown, cookie?: string): NextRequest {
  return new NextRequest('http://x/api/auth/2fa/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabledMock.mockReturnValue(null);
  isRateLimitedMock.mockResolvedValue(false);
  verifyPendingMock.mockResolvedValue({ sub: 'u1' });
  verifyCodeMock.mockResolvedValue({ ok: true, method: 'challenge' });
  findUniqueMock.mockResolvedValue(USER);
  buildClaimsMock.mockResolvedValue({ ok: true, claims: { sub: 'u1', role: 'manager' } });
  signTokenMock.mockResolvedValue('session-jwt');
  recordAuditMock.mockResolvedValue(undefined);
});

describe('POST /api/auth/2fa/verify', () => {
  it('404 when the flag is disabled', async () => {
    notFoundIfDisabledMock.mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await POST(req({ code: '123456' }, '2fa_pending=t'));
    expect(res.status).toBe(404);
  });

  it('429 when rate-limited', async () => {
    isRateLimitedMock.mockResolvedValue(true);
    const res = await POST(req({ code: '123456' }, '2fa_pending=t'));
    expect(res.status).toBe(429);
  });

  it('rate-limit key uses the first x-forwarded-for hop', async () => {
    isRateLimitedMock.mockResolvedValue(false);
    const r = new NextRequest('http://x/api/auth/2fa/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: '2fa_pending=t',
        'x-forwarded-for': '203.0.113.9, 10.0.0.1'
      },
      body: JSON.stringify({ code: '123456' })
    });
    await POST(r);
    expect(isRateLimitedMock).toHaveBeenCalledWith('2fa-verify:203.0.113.9', expect.anything());
  });

  it('401 SESSION_EXPIRED without the pending cookie', async () => {
    const res = await POST(req({ code: '123456' }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SESSION_EXPIRED');
  });

  it('401 SESSION_EXPIRED on a broken pending token', async () => {
    verifyPendingMock.mockRejectedValue(new Error('bad token'));
    const res = await POST(req({ code: '123456' }, '2fa_pending=garbage'));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SESSION_EXPIRED');
  });

  it('400 on invalid body', async () => {
    const res = await POST(req({ nope: true }, '2fa_pending=t'));
    expect(res.status).toBe(400);
  });

  it.each([
    ['code_expired', 'CODE_EXPIRED'],
    ['too_many_attempts', 'TOO_MANY_ATTEMPTS'],
    ['invalid_code', 'INVALID_CODE']
  ] as const)('401 %s → %s; audit 2fa_failed with reason', async (serviceError, apiCode) => {
    verifyCodeMock.mockResolvedValue({ ok: false, error: serviceError });
    const res = await POST(req({ code: '000000' }, '2fa_pending=t'));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe(apiCode);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: '2fa_failed', reason: serviceError })
    );
  });

  it('happy path: session cookie set, pending cookie cleared, audit 2fa_verified', async () => {
    const res = await POST(req({ code: '123456' }, '2fa_pending=t'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('session=session-jwt');
    expect(setCookie).toContain('2fa_pending=;');
    expect(verifyCodeMock).toHaveBeenCalledWith(expect.anything(), 'u1', '123456');
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: '2fa_verified' })
    );
  });

  it('trims the submitted code', async () => {
    await POST(req({ code: ' 123456 ' }, '2fa_pending=t'));
    expect(verifyCodeMock).toHaveBeenCalledWith(expect.anything(), 'u1', '123456');
  });

  it('backup method → audit 2fa_backup_used', async () => {
    verifyCodeMock.mockResolvedValue({ ok: true, method: 'backup' });
    const res = await POST(req({ code: 'BACKUPCODE' }, '2fa_pending=t'));
    expect(res.status).toBe(200);
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: '2fa_backup_used' })
    );
  });

  it('401 SESSION_EXPIRED when the user vanished or is inactive', async () => {
    findUniqueMock.mockResolvedValue(null);
    const res = await POST(req({ code: '123456' }, '2fa_pending=t'));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SESSION_EXPIRED');
  });

  it('403 ACCOUNT_DEACTIVATED when claims build fails', async () => {
    buildClaimsMock.mockResolvedValue({ ok: false, error: 'account_deactivated' });
    const res = await POST(req({ code: '123456' }, '2fa_pending=t'));
    expect(res.status).toBe(403);
  });

  it('audit failures never break verification (best-effort)', async () => {
    recordAuditMock.mockRejectedValue(new Error('audit down'));
    const res = await POST(req({ code: '123456' }, '2fa_pending=t'));
    expect(res.status).toBe(200);
  });
});
