import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before imports
// ---------------------------------------------------------------------------
vi.mock('@/lib/db/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/auth/audit', () => ({
  recordAudit: vi.fn(),
}));

vi.mock('@/lib/auth/passwordReset', () => ({
  verifyAndConsumeToken: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn() },
}));

// Лимитер здесь всегда пропускает: 429-контракт покрыт отдельным
// api.auth.ratelimit.test.ts; этот файл тестирует доменную логику маршрута.
vi.mock('@/lib/rateLimit', () => ({
  isRateLimited: vi.fn().mockResolvedValue(false),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { prisma } from '@/lib/db/prisma';
import { recordAudit } from '@/lib/auth/audit';
import { verifyAndConsumeToken } from '@/lib/auth/passwordReset';
import bcrypt from 'bcryptjs';
import { POST } from '@/app/api/auth/reset-password/confirm/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonReq(body: unknown) {
  return new Request('http://x/api/auth/reset-password/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as unknown as import('next/server').NextRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/auth/reset-password/confirm', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never);
  });

  // --- Happy path -----------------------------------------------------------

  it('200 { ok: true } and writes audit row on valid token + strong password', async () => {
    vi.mocked(verifyAndConsumeToken).mockResolvedValue({ ok: true, userId: 'user-1' });
    vi.mocked(recordAudit).mockResolvedValue(undefined);

    const res = await POST(jsonReq({ token: 'valid-token', newPassword: 'strongpass' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(bcrypt.hash).toHaveBeenCalledWith('strongpass', 10);
    expect(verifyAndConsumeToken).toHaveBeenCalledWith(prisma, 'valid-token', 'hashed-password');

    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'user-1',
      action: 'password_reset',
      entity: 'user',
      entityId: 'user-1',
      status: 'success',
    });
  });

  // --- Validation failures --------------------------------------------------

  it('400 weak_password when newPassword is shorter than 8 chars', async () => {
    const res = await POST(jsonReq({ token: 'some-token', newPassword: 'short' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'weak_password' });
    expect(verifyAndConsumeToken).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('400 invalid_request when token is missing', async () => {
    const res = await POST(jsonReq({ newPassword: 'strongpass' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_request');
    expect(verifyAndConsumeToken).not.toHaveBeenCalled();
  });

  it('400 invalid_request when body is invalid JSON', async () => {
    const req = new Request('http://x/api/auth/reset-password/confirm', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    }) as unknown as import('next/server').NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(verifyAndConsumeToken).not.toHaveBeenCalled();
  });

  // --- Token verification failures — all collapse to invalid_token ----------

  it('400 invalid_token when verifyAndConsumeToken returns not_found', async () => {
    vi.mocked(verifyAndConsumeToken).mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await POST(jsonReq({ token: 'bad-token', newPassword: 'strongpass' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('400 invalid_token when verifyAndConsumeToken returns expired', async () => {
    vi.mocked(verifyAndConsumeToken).mockResolvedValue({ ok: false, reason: 'expired' });

    const res = await POST(jsonReq({ token: 'expired-token', newPassword: 'strongpass' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('400 invalid_token when verifyAndConsumeToken returns used', async () => {
    vi.mocked(verifyAndConsumeToken).mockResolvedValue({ ok: false, reason: 'used' });

    const res = await POST(jsonReq({ token: 'used-token', newPassword: 'strongpass' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  // --- No audit on failure --------------------------------------------------

  it('does not write audit row when token verification fails', async () => {
    vi.mocked(verifyAndConsumeToken).mockResolvedValue({ ok: false, reason: 'not_found' });

    await POST(jsonReq({ token: 'bad-token', newPassword: 'strongpass' }));

    expect(recordAudit).not.toHaveBeenCalled();
  });
});
