/**
 * R0.6 — 429-контракты публичных auth-маршрутов через общий Redis-backed
 * лимитер @/lib/rateLimit (login переведён с приватного in-memory Map;
 * reset-password request/confirm раньше не лимитировались вовсе).
 *
 * Лимитер мокается: ключи и опции ассертятся точно, сеть не трогается.
 * Поведение самого лимитера покрыто lib.rateLimit.test.ts; «живой» hammer
 * логина (11-й запрос → 429 через memory-fallback) — auth.login.ratelimit.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isRateLimited, findUnique, verifyAndConsumeToken } = vi.hoisted(() => ({
  isRateLimited: vi.fn(),
  findUnique: vi.fn(),
  verifyAndConsumeToken: vi.fn()
}));

vi.mock('@/lib/rateLimit', () => ({ isRateLimited }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique },
    partnerUser: { findUnique: vi.fn().mockResolvedValue(null) }
  }
}));
vi.mock('@/lib/auth/passwordReset', () => ({
  createInviteToken: vi.fn(),
  verifyAndConsumeToken
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ send: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn().mockResolvedValue('h') } }));
vi.mock('@/lib/auth/jwt', () => ({ signToken: vi.fn() }));

import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as resetRequestPost } from '@/app/api/auth/reset-password/request/route';
import { POST as resetConfirmPost } from '@/app/api/auth/reset-password/confirm/route';

type NextReq = import('next/server').NextRequest;

function req(url: string, body: unknown, headers: Record<string, string> = {}): NextReq {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers }
  }) as unknown as NextReq;
}

beforeEach(() => {
  vi.clearAllMocks();
  isRateLimited.mockResolvedValue(false);
});

describe('login — общий лимитер', () => {
  it('лимит превышен → 429 TOO_MANY_REQUESTS, ключ login:<ip>, до чтения тела', async () => {
    isRateLimited.mockResolvedValueOnce(true);
    const res = await loginPost(
      req('https://app.local/api/auth/login', { email: 'a@b.ru', password: 'x' }, { 'x-forwarded-for': '1.2.3.4' })
    );
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('TOO_MANY_REQUESTS');
    expect(isRateLimited).toHaveBeenCalledWith('login:1.2.3.4', { windowMs: 60_000, max: 10 });
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('reset-password/request — лимиты per-IP и per-email', () => {
  it('IP-лимит превышен → 429 до чтения тела; ключ по первому XFF-адресу', async () => {
    isRateLimited.mockResolvedValueOnce(true);
    const res = await resetRequestPost(
      req(
        'https://app.local/api/auth/reset-password/request',
        { email: 'user@example.com' },
        { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }
      )
    );
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('too_many_requests');
    expect(isRateLimited).toHaveBeenCalledTimes(1);
    expect(isRateLimited).toHaveBeenCalledWith('reset-request:ip:9.9.9.9', {
      windowMs: 3_600_000,
      max: 20
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('email-лимит превышен → 429; ключ нормализован в lower-case; БД не трогается', async () => {
    isRateLimited.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await resetRequestPost(
      req(
        'https://app.local/api/auth/reset-password/request',
        { email: 'User@Example.com' },
        { 'x-real-ip': '7.7.7.7' }
      )
    );
    expect(res.status).toBe(429);
    expect(isRateLimited).toHaveBeenNthCalledWith(1, 'reset-request:ip:7.7.7.7', {
      windowMs: 3_600_000,
      max: 20
    });
    expect(isRateLimited).toHaveBeenNthCalledWith(2, 'reset-request:email:user@example.com', {
      windowMs: 3_600_000,
      max: 5
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('лимиты не превышены → прежний enumeration-guard контракт { ok: true }', async () => {
    findUnique.mockResolvedValue(null);
    const res = await resetRequestPost(
      req('https://app.local/api/auth/reset-password/request', { email: 'nobody@example.com' })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(isRateLimited).toHaveBeenCalledTimes(2);
  });
});

describe('reset-password/confirm — лимит per-IP (анти-перебор токенов)', () => {
  it('лимит превышен → 429, verifyAndConsumeToken не вызывается', async () => {
    isRateLimited.mockResolvedValueOnce(true);
    const res = await resetConfirmPost(
      req(
        'https://app.local/api/auth/reset-password/confirm',
        { token: 't', newPassword: 'password1' },
        { 'x-real-ip': '8.8.8.8' }
      )
    );
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('too_many_requests');
    expect(isRateLimited).toHaveBeenCalledWith('reset-confirm:ip:8.8.8.8', {
      windowMs: 60_000,
      max: 10
    });
    expect(verifyAndConsumeToken).not.toHaveBeenCalled();
  });

  it('лимит не превышен → прежний контракт (invalid_token → 400); ключ по первому XFF', async () => {
    verifyAndConsumeToken.mockResolvedValue({ ok: false });
    const res = await resetConfirmPost(
      req(
        'https://app.local/api/auth/reset-password/confirm',
        { token: 'bad', newPassword: 'password1' },
        { 'x-forwarded-for': '6.6.6.6, 1.1.1.1' }
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_token');
    expect(isRateLimited).toHaveBeenCalledWith('reset-confirm:ip:6.6.6.6', {
      windowMs: 60_000,
      max: 10
    });
  });
});
