import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  requireRole,
  findUnique,
  updateMany,
  auditCreate,
  transaction
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn()
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    studentBridgeGrant: { findUnique, updateMany },
    auditLog: { create: auditCreate },
    $transaction: transaction
  }
}));

import { POST } from '@/app/api/student/bridge/token/route';

function buildReq(body: unknown, headers?: Record<string, string>) {
  const map = new Map<string, string>(
    Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Request;
}

function buildTxClient() {
  return {
    studentBridgeGrant: { findUnique, updateMany },
    auditLog: { create: auditCreate }
  };
}

describe('POST /api/student/bridge/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: { sub: 'u1' } });
    requireRole.mockReturnValue({ ok: true });
    transaction.mockImplementation(async (cb: (tx: ReturnType<typeof buildTxClient>) => unknown) => cb(buildTxClient()));
    process.env.STUDENT_BRIDGE_SHARED_SECRET = 'shared-secret';
    process.env.STUDENT_BRIDGE_RATE_LIMIT_MAX = '50';
    process.env.STUDENT_BRIDGE_RATE_LIMIT_WINDOW_MS = '60000';
    // Force the in-memory rate-limit backend so the route test never reaches a
    // real Redis connection (the shared limiter degrades to memory when unset).
    delete process.env.REDIS_URL;
  });

  it('denies untrusted bridge client', async () => {
    const req = buildReq({ code: 'abc' }, { 'x-bridge-client': 'svc-a', 'x-bridge-secret': 'wrong-but-same-len' });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(auditCreate).toHaveBeenCalled();
  });

  it('returns safe error for missing and invalid code', async () => {
    const headers = { 'x-bridge-client': 'svc-a', 'x-bridge-secret': 'shared-secret' };
    const missingRes = await POST(buildReq({}, headers) as never);
    expect(missingRes.status).toBe(400);
    expect(await missingRes.json()).toEqual({ error: 'invalid exchange request' });

    updateMany.mockResolvedValueOnce({ count: 0 });
    findUnique.mockResolvedValueOnce(null);
    const invalidRes = await POST(buildReq({ code: 'bad-code' }, headers) as never);
    expect(invalidRes.status).toBe(400);
    expect(await invalidRes.json()).toEqual({ error: 'invalid exchange request' });
  });

  it('handles expired grant', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    findUnique.mockResolvedValueOnce({
      jti: 'j1',
      expiresAt: new Date(Date.now() - 10_000),
      usedAt: null
    });

    const res = await POST(
      buildReq({ code: 'abc123' }, { 'x-bridge-client': 'svc-a', 'x-bridge-secret': 'shared-secret' }) as never
    );
    expect(res.status).toBe(410);
    expect(auditCreate).toHaveBeenCalled();
  });

  it('handles reused grant', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    findUnique.mockResolvedValueOnce({
      jti: 'j1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date()
    });

    const res = await POST(
      buildReq({ code: 'abc123' }, { 'x-bridge-client': 'svc-a', 'x-bridge-secret': 'shared-secret' }) as never
    );
    expect(res.status).toBe(410);
    expect(auditCreate).toHaveBeenCalled();
  });

  it('exchanges valid one-time code', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    findUnique.mockResolvedValueOnce({ jti: 'j1', token: 'token-1' });
    auditCreate.mockResolvedValueOnce({});

    const res = await POST(
      buildReq({ code: 'abc123' }, { 'x-bridge-client': 'svc-a', 'x-bridge-secret': 'shared-secret' }) as never
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'token-1', token_type: 'Bearer' });
    expect(updateMany).toHaveBeenCalled();
    expect(transaction).toHaveBeenCalled();
  });
});
