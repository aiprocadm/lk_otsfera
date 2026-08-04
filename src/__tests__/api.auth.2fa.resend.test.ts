import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  findUniqueMock,
  notFoundIfDisabledMock,
  verifyPendingMock,
  createChallengeMock,
  sendMock,
  recordAuditMock,
  isRateLimitedMock,
  discardChallengeMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  notFoundIfDisabledMock: vi.fn(),
  verifyPendingMock: vi.fn(),
  createChallengeMock: vi.fn(),
  sendMock: vi.fn(),
  recordAuditMock: vi.fn(),
  isRateLimitedMock: vi.fn(),
  discardChallengeMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: findUniqueMock } },
}));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: notFoundIfDisabledMock }));
vi.mock('@/lib/auth/jwt', () => ({ verifyTwoFactorPendingToken: verifyPendingMock }));
vi.mock('@/lib/services/auth/twoFactor', () => ({
  createTwoFactorChallenge: createChallengeMock,
  discardTwoFactorChallenge: discardChallengeMock,
}));
vi.mock('@/lib/email/send', () => ({ send: sendMock }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/rateLimit', () => ({ isRateLimited: isRateLimitedMock }));

import { POST } from '@/app/api/auth/2fa/resend/route';

function req(cookie?: string): NextRequest {
  return new NextRequest('http://x/api/auth/2fa/resend', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabledMock.mockReturnValue(null);
  verifyPendingMock.mockResolvedValue({ sub: 'u1' });
  isRateLimitedMock.mockResolvedValue(false);
  findUniqueMock.mockResolvedValue({ id: 'u1', email: 'm@x.ru', name: 'М', isActive: true });
  createChallengeMock.mockResolvedValue({ code: '654321' });
  sendMock.mockResolvedValue(undefined);
  recordAuditMock.mockResolvedValue(undefined);
  discardChallengeMock.mockResolvedValue(undefined);
});

describe('POST /api/auth/2fa/resend', () => {
  it('404 when the flag is disabled', async () => {
    notFoundIfDisabledMock.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await POST(req('2fa_pending=t'))).status).toBe(404);
  });

  it('401 without the pending cookie', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('SESSION_EXPIRED');
  });

  it('401 on a broken pending token', async () => {
    verifyPendingMock.mockRejectedValue(new Error('bad'));
    expect((await POST(req('2fa_pending=x'))).status).toBe(401);
  });

  it('429 when the 30s cooldown key trips', async () => {
    isRateLimitedMock.mockImplementation(async (key: string) => key.startsWith('2fa-resend-cool:'));
    const res = await POST(req('2fa_pending=t'));
    expect(res.status).toBe(429);
    expect(createChallengeMock).not.toHaveBeenCalled();
  });

  it('429 when the 3-per-window total key trips', async () => {
    isRateLimitedMock.mockImplementation(async (key: string) =>
      key.startsWith('2fa-resend-total:')
    );
    expect((await POST(req('2fa_pending=t'))).status).toBe(429);
  });

  it('401 when the user vanished or is inactive', async () => {
    findUniqueMock.mockResolvedValue(null);
    expect((await POST(req('2fa_pending=t'))).status).toBe(401);
  });

  it('happy path: new challenge + email + audit', async () => {
    const res = await POST(req('2fa_pending=t'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createChallengeMock).toHaveBeenCalledWith(expect.anything(), 'u1');
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'm@x.ru' }));
    expect(sendMock.mock.calls[0][0].text).toContain('654321');
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: '2fa_code_sent' })
    );
  });

  it('502 EMAIL_SEND_FAILED when the transport fails; challenge deleted', async () => {
    sendMock.mockRejectedValue(new Error('resend down'));
    const res = await POST(req('2fa_pending=t'));
    expect(res.status).toBe(502);
    // Сам prisma-запрос удаления проверяется в
    // services.auth.login-flow.unit.test.ts (сервис discardTwoFactorChallenge).
    expect(discardChallengeMock).toHaveBeenCalledWith(expect.anything(), 'u1');
  });

  it('non-Error send rejection (string) → 502 (String(err) log arm)', async () => {
    sendMock.mockRejectedValue('smtp string down');
    expect((await POST(req('2fa_pending=t'))).status).toBe(502);
  });

  it('audit failure does not break the resend (best-effort)', async () => {
    recordAuditMock.mockRejectedValue(new Error('audit down'));
    expect((await POST(req('2fa_pending=t'))).status).toBe(200);
  });
});
