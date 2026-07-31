/**
 * Этап 9 (ФТ-11.3) — отметка «последний вход» (User.lastLoginAt).
 *
 * Записать её должны ОБА пути входа: обычный логин (пароль) и второй шаг
 * staff-2FA. Важные инварианты:
 *  - отметка ставится только когда сессия реально выдана (есть cookie);
 *  - на ветке «staff + флаг staff_2fa ON» сессии ещё нет → отметки тоже нет;
 *  - апдейт best-effort (§3): его падение не должно отбирать у пользователя
 *    сессию, честно заработанную верным паролем/кодом.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  findUniqueMock,
  updateUserMock,
  compareMock,
  isRateLimitedMock,
  isFeatureEnabledMock,
  notFoundIfDisabledMock,
  createChallengeMock,
  verifyCodeMock,
  sendMock,
  buildClaimsMock,
  signTokenMock,
  signPendingMock,
  verifyPendingMock,
  recordAuditMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateUserMock: vi.fn(),
  compareMock: vi.fn(),
  isRateLimitedMock: vi.fn(),
  isFeatureEnabledMock: vi.fn(),
  notFoundIfDisabledMock: vi.fn(),
  createChallengeMock: vi.fn(),
  verifyCodeMock: vi.fn(),
  sendMock: vi.fn(),
  buildClaimsMock: vi.fn(),
  signTokenMock: vi.fn(),
  signPendingMock: vi.fn(),
  verifyPendingMock: vi.fn(),
  recordAuditMock: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: findUniqueMock, update: updateUserMock },
    twoFactorChallenge: { delete: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('bcryptjs', () => ({ default: { compare: compareMock } }));
vi.mock('@/lib/rateLimit', () => ({ isRateLimited: isRateLimitedMock }));
vi.mock('@/lib/featureFlags', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
  notFoundIfDisabled: notFoundIfDisabledMock,
}));
vi.mock('@/lib/services/auth/twoFactor', () => ({
  createTwoFactorChallenge: createChallengeMock,
  verifyTwoFactorCode: verifyCodeMock,
}));
vi.mock('@/lib/email/send', () => ({ send: sendMock }));
vi.mock('@/lib/auth/buildSessionClaims', () => ({ buildSessionClaims: buildClaimsMock }));
vi.mock('@/lib/auth/jwt', () => ({
  signToken: signTokenMock,
  signTwoFactorPendingToken: signPendingMock,
  verifyTwoFactorPendingToken: verifyPendingMock,
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));

import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as verifyPost } from '@/app/api/auth/2fa/verify/route';

const PARTNER = {
  id: 'u-partner',
  email: 'p@x.ru',
  name: 'Партнёр',
  role: 'partner',
  passwordHash: 'hash',
  isActive: true,
  companyId: null,
  partnerId: 'p1',
  organizationId: null,
  externalStudentId: null,
};

const MANAGER = {
  ...PARTNER,
  id: 'u-mgr',
  email: 'm@x.ru',
  role: 'manager',
  partnerId: null,
  companyId: 'c1',
};

function loginReq(body: unknown): Request {
  return new Request('http://x/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function verifyReq(body: unknown, cookie = '2fa_pending=t'): NextRequest {
  return new NextRequest('http://x/api/auth/2fa/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isRateLimitedMock.mockResolvedValue(false);
  compareMock.mockResolvedValue(true);
  isFeatureEnabledMock.mockReturnValue(false);
  notFoundIfDisabledMock.mockReturnValue(null);
  createChallengeMock.mockResolvedValue({ code: '123456' });
  verifyCodeMock.mockResolvedValue({ ok: true, method: 'challenge' });
  sendMock.mockResolvedValue(undefined);
  findUniqueMock.mockResolvedValue(PARTNER);
  buildClaimsMock.mockResolvedValue({ ok: true, claims: { sub: 'u-partner', role: 'partner' } });
  signTokenMock.mockResolvedValue('session-jwt');
  signPendingMock.mockResolvedValue('pending-jwt');
  verifyPendingMock.mockResolvedValue({ sub: 'u-mgr' });
  recordAuditMock.mockResolvedValue(undefined);
  updateUserMock.mockResolvedValue({});
});

describe('POST /api/auth/login — отметка lastLoginAt', () => {
  it('успешный вход → user.update ставит lastLoginAt по id пользователя', async () => {
    const before = Date.now();

    const res = await loginPost(loginReq({ email: 'p@x.ru', password: 'pw' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toContain('session=session-jwt');
    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: 'u-partner' },
      data: { lastLoginAt: expect.any(Date) },
    });
    // Отметка — «сейчас», а не какая-то произвольная дата
    const { lastLoginAt } = updateUserMock.mock.calls[0][0].data as { lastLoginAt: Date };
    expect(lastLoginAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(lastLoginAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('staff + staff_2fa ON (сессия НЕ выдана) → lastLoginAt не пишется', async () => {
    isFeatureEnabledMock.mockReturnValue(true);
    findUniqueMock.mockResolvedValue(MANAGER);
    buildClaimsMock.mockResolvedValue({ ok: true, claims: { sub: 'u-mgr', role: 'manager' } });

    const res = await loginPost(loginReq({ email: 'm@x.ru', password: 'pw' }));

    expect(await res.json()).toEqual({ ok: true, twoFactorRequired: true });
    expect(res.headers.get('set-cookie') ?? '').not.toContain('session=');
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('staff + staff_2fa OFF → сессия выдана сразу, значит lastLoginAt пишется', async () => {
    findUniqueMock.mockResolvedValue(MANAGER);
    buildClaimsMock.mockResolvedValue({ ok: true, claims: { sub: 'u-mgr', role: 'manager' } });

    const res = await loginPost(loginReq({ email: 'm@x.ru', password: 'pw' }));

    expect(res.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: 'u-mgr' },
      data: { lastLoginAt: expect.any(Date) },
    });
  });

  it('неверный пароль → 401 и никакой отметки', async () => {
    compareMock.mockResolvedValue(false);

    const res = await loginPost(loginReq({ email: 'p@x.ru', password: 'bad' }));

    expect(res.status).toBe(401);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('неизвестный e-mail → 401 и никакой отметки', async () => {
    findUniqueMock.mockResolvedValue(null);
    compareMock.mockResolvedValue(false);

    const res = await loginPost(loginReq({ email: 'nobody@x.ru', password: 'pw' }));

    expect(res.status).toBe(401);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('деактивированный аккаунт → 403 и никакой отметки', async () => {
    buildClaimsMock.mockResolvedValue({ ok: false, error: 'account_deactivated' });

    const res = await loginPost(loginReq({ email: 'p@x.ru', password: 'pw' }));

    expect(res.status).toBe(403);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('невалидное тело запроса → 400, до отметки дело не доходит', async () => {
    const res = await loginPost(loginReq({ email: 'not-an-email', password: '' }));

    expect(res.status).toBe(400);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('сбой update не ломает вход: 200 + cookie сессии на месте (fail-open §3)', async () => {
    updateUserMock.mockRejectedValue(new Error('db down'));

    const res = await loginPost(loginReq({ email: 'p@x.ru', password: 'pw' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('set-cookie') ?? '').toContain('session=session-jwt');
    expect(signTokenMock).toHaveBeenCalled();
  });
});

describe('POST /api/auth/2fa/verify — отметка lastLoginAt', () => {
  it('успешная верификация кода → lastLoginAt пишется по sub из pre-auth токена', async () => {
    const before = Date.now();

    const res = await verifyPost(verifyReq({ code: '123456' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toContain('session=session-jwt');
    expect(updateUserMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: 'u-mgr' },
      data: { lastLoginAt: expect.any(Date) },
    });
    const { lastLoginAt } = updateUserMock.mock.calls[0][0].data as { lastLoginAt: Date };
    expect(lastLoginAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(lastLoginAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('backup-код тоже считается входом → отметка ставится', async () => {
    verifyCodeMock.mockResolvedValue({ ok: true, method: 'backup' });

    const res = await verifyPost(verifyReq({ code: 'BACKUPCODE' }));

    expect(res.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: 'u-mgr' },
      data: { lastLoginAt: expect.any(Date) },
    });
  });

  it('неверный код → 401 и никакой отметки', async () => {
    verifyCodeMock.mockResolvedValue({ ok: false, error: 'invalid_code' });

    const res = await verifyPost(verifyReq({ code: '000000' }));

    expect(res.status).toBe(401);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('деактивированный аккаунт на втором шаге → 403 и никакой отметки', async () => {
    buildClaimsMock.mockResolvedValue({ ok: false, error: 'account_deactivated' });

    const res = await verifyPost(verifyReq({ code: '123456' }));

    expect(res.status).toBe(403);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('сбой update не ломает выдачу сессии: 200 + cookie на месте (fail-open §3)', async () => {
    updateUserMock.mockRejectedValue(new Error('db down'));

    const res = await verifyPost(verifyReq({ code: '123456' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('session=session-jwt');
    expect(setCookie).toContain('2fa_pending=;');
  });
});
