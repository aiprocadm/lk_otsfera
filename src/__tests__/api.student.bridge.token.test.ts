import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must precede any import that would load the real modules.
// ---------------------------------------------------------------------------
const {
  requireSession,
  requireRole,
  recordAudit,
  isRateLimited,
  grantUpdateMany,
  grantFindUnique,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
  recordAudit: vi.fn(),
  isRateLimited: vi.fn(),
  grantUpdateMany: vi.fn(),
  grantFindUnique: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/rateLimit', () => ({ isRateLimited }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        studentBridgeGrant: {
          updateMany: grantUpdateMany,
          findUnique: grantFindUnique,
        },
        auditLog: { create: vi.fn().mockResolvedValue(undefined) },
      })
    ),
  },
}));

import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/student/bridge/token/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SHARED_SECRET = 'test-bridge-secret-abc';
const CLIENT_ID = 'lms-client-1';

const studentSession = { sub: 'u-student-1', role: 'student' as const };

function buildReq(opts: {
  clientId?: string;
  secret?: string;
  body?: unknown;
  ip?: string;
}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.clientId !== undefined) headers['x-bridge-client'] = opts.clientId;
  if (opts.secret !== undefined) headers['x-bridge-secret'] = opts.secret;
  if (opts.ip !== undefined) headers['x-forwarded-for'] = opts.ip;

  return new Request('https://app.local/api/student/bridge/token', {
    method: 'POST',
    headers,
    // Тело без значения — просто не передаём ключ (RequestInit при
    // exactOptionalPropertyTypes не принимает `body: undefined`).
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  }) as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/student/bridge/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STUDENT_BRIDGE_SHARED_SECRET = SHARED_SECRET;
    process.env.STUDENT_BRIDGE_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.STUDENT_BRIDGE_RATE_LIMIT_MAX = '10';

    requireSession.mockResolvedValue({ ok: true, value: studentSession });
    requireRole.mockReturnValue({ ok: true, value: studentSession });
    isRateLimited.mockResolvedValue(false);
    recordAudit.mockResolvedValue(undefined);

    // Default: successful claim
    grantUpdateMany.mockResolvedValue({ count: 1 });
    grantFindUnique.mockResolvedValue({ jti: 'jti-1', token: 'student-jwt-token' });
  });

  it('401 when requireSession fails', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await POST(
      buildReq({ clientId: CLIENT_ID, secret: SHARED_SECRET, body: { code: 'abc123' } })
    );
    expect(res.status).toBe(401);
  });

  it('403 when role is not student', async () => {
    requireRole.mockReturnValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });
    const res = await POST(
      buildReq({ clientId: CLIENT_ID, secret: SHARED_SECRET, body: { code: 'abc123' } })
    );
    expect(res.status).toBe(403);
  });

  it('403 when x-bridge-client header is missing (empty clientId)', async () => {
    const res = await POST(
      buildReq({ clientId: '', secret: SHARED_SECRET, body: { code: 'abc123' } })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bridge client denied');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'STUDENT_BRIDGE_CLIENT_DENIED' })
    );
  });

  it('403 when x-bridge-client header is completely absent (?? "" fallback for clientId)', async () => {
    // Omitting clientId option means the header is absent entirely → get() returns null
    // → ?.trim() returns undefined → ?? '' = '' → covers the ?? '' fallback branch
    const res = await POST(buildReq({ secret: SHARED_SECRET, body: { code: 'abc123' } }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bridge client denied');
  });

  it('403 when x-bridge-secret header is completely absent (?? "" fallback for sharedSecret)', async () => {
    // Omitting secret option means the header is absent → get() returns null
    // → ?.trim() returns undefined → ?? '' = '' → covers the ?? '' fallback branch on sharedSecret
    const res = await POST(buildReq({ clientId: CLIENT_ID, body: { code: 'abc123' } }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bridge client denied');
  });

  it('403 when STUDENT_BRIDGE_SHARED_SECRET env is not set (empty expectedSecret)', async () => {
    delete process.env.STUDENT_BRIDGE_SHARED_SECRET;
    const res = await POST(
      buildReq({ clientId: CLIENT_ID, secret: SHARED_SECRET, body: { code: 'abc123' } })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bridge client denied');
  });

  it('403 when x-bridge-secret header is wrong', async () => {
    const res = await POST(
      buildReq({ clientId: CLIENT_ID, secret: 'wrong-secret', body: { code: 'abc123' } })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bridge client denied');
  });

  it('429 when rate limit is exceeded', async () => {
    isRateLimited.mockResolvedValue(true);
    const res = await POST(
      buildReq({ clientId: CLIENT_ID, secret: SHARED_SECRET, body: { code: 'abc123' } })
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('too many requests');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'STUDENT_BRIDGE_RATE_LIMITED' })
    );
  });

  it('400 when body has no code', async () => {
    const res = await POST(buildReq({ clientId: CLIENT_ID, secret: SHARED_SECRET, body: {} }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid exchange request');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'STUDENT_BRIDGE_CODE_REJECTED',
        reason: 'missing-or-invalid-code',
      })
    );
  });

  it('400 when body is not valid JSON (code is null after catch)', async () => {
    const req = new Request('https://app.local/api/student/bridge/token', {
      method: 'POST',
      headers: {
        'x-bridge-client': CLIENT_ID,
        'x-bridge-secret': SHARED_SECRET,
      },
      body: 'NOT JSON',
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400 when grant is not found in DB (code does not exist → null grant in second lookup)', async () => {
    grantUpdateMany.mockResolvedValue({ count: 0 });
    // First findUnique returns null (code not in DB at all)
    grantFindUnique.mockResolvedValue(null);

    const res = await POST(
      buildReq({ clientId: CLIENT_ID, secret: SHARED_SECRET, body: { code: 'nonexistent' } })
    );
    expect(res.status).toBe(400);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'STUDENT_BRIDGE_CODE_REJECTED',
        reason: 'missing-or-invalid-code',
      })
    );
  });

  it('410 when code was already used (reuse blocked — usedAt is set)', async () => {
    grantUpdateMany.mockResolvedValue({ count: 0 });
    // First findUnique returns a grant with usedAt set → "already-used"
    grantFindUnique.mockResolvedValue({
      jti: 'jti-used',
      usedAt: new Date('2026-06-15T10:00:00Z'),
      expiresAt: new Date('2026-06-15T10:05:00Z'),
    });

    const res = await POST(
      buildReq({ clientId: CLIENT_ID, secret: SHARED_SECRET, body: { code: 'used-code' } })
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('code is no longer valid');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'STUDENT_BRIDGE_CODE_REUSE_BLOCKED',
        reason: 'already-used',
      })
    );
  });

  it('410 when code has expired (usedAt is null but expiresAt in past)', async () => {
    grantUpdateMany.mockResolvedValue({ count: 0 });
    // findUnique returns a grant with usedAt null → "expired"
    grantFindUnique.mockResolvedValue({
      jti: 'jti-expired',
      usedAt: null,
      expiresAt: new Date('2026-06-01T00:00:00Z'),
    });

    const res = await POST(
      buildReq({ clientId: CLIENT_ID, secret: SHARED_SECRET, body: { code: 'expired-code' } })
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('code is no longer valid');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'STUDENT_BRIDGE_CODE_REUSE_BLOCKED', reason: 'expired' })
    );
  });

  it('400 when claim succeeds but grant disappears (race condition: !grant after updateMany)', async () => {
    // updateMany returns count=1 (claimed) but subsequent findUnique returns null
    // This covers the if (!grant) return { kind: 'rejected', grant: null } branch
    grantUpdateMany.mockResolvedValue({ count: 1 });
    grantFindUnique.mockResolvedValue(null); // race: grant was deleted between claim and fetch

    const res = await POST(
      buildReq({ clientId: CLIENT_ID, secret: SHARED_SECRET, body: { code: 'race-code' } })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid exchange request');
  });

  it('200 returns token on successful code exchange', async () => {
    grantUpdateMany.mockResolvedValue({ count: 1 });
    grantFindUnique.mockResolvedValue({ jti: 'jti-ok', token: 'signed-jwt-abc' });

    const res = await POST(
      buildReq({
        clientId: CLIENT_ID,
        secret: SHARED_SECRET,
        body: { code: 'valid-code' },
        ip: '1.2.3.4',
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; token_type: string };
    expect(body.token).toBe('signed-jwt-abc');
    expect(body.token_type).toBe('Bearer');
  });

  it('uses x-real-ip when x-forwarded-for is absent', async () => {
    grantUpdateMany.mockResolvedValue({ count: 1 });
    grantFindUnique.mockResolvedValue({ jti: 'jti-ok', token: 'jwt' });

    const req = new Request('https://app.local/api/student/bridge/token', {
      method: 'POST',
      headers: {
        'x-bridge-client': CLIENT_ID,
        'x-bridge-secret': SHARED_SECRET,
        'x-real-ip': '10.0.0.1',
      },
      body: JSON.stringify({ code: 'valid-code' }),
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(200);
    // isRateLimited should have been called with the ip from x-real-ip
    expect(isRateLimited).toHaveBeenCalledWith(`${CLIENT_ID}:10.0.0.1`, expect.any(Object));
  });
});
