import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  requireRole,
  findUnique,
  update,
  auditCreate,
  transaction
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn()
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    studentBridgeGrant: { findUnique, update },
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

describe('POST /api/student/bridge/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: { user: { id: 'u1' } } });
    requireRole.mockReturnValue({ ok: true });
    process.env.STUDENT_BRIDGE_SHARED_SECRET = 'shared-secret';
    process.env.STUDENT_BRIDGE_RATE_LIMIT_MAX = '50';
    process.env.STUDENT_BRIDGE_RATE_LIMIT_WINDOW_MS = '60000';
  });

  it('denies untrusted bridge client', async () => {
    const req = buildReq({ code: 'abc' }, { 'x-bridge-client': 'svc-a', 'x-bridge-secret': 'wrong' });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect(auditCreate).toHaveBeenCalled();
  });

  it('returns safe error for missing and invalid code', async () => {
    const headers = { 'x-bridge-client': 'svc-a', 'x-bridge-secret': 'shared-secret' };
    const missingRes = await POST(buildReq({}, headers) as never);
    expect(missingRes.status).toBe(400);
    expect(await missingRes.json()).toEqual({ error: 'invalid exchange request' });

    findUnique.mockResolvedValueOnce(null);
    const invalidRes = await POST(buildReq({ code: 'bad-code' }, headers) as never);
    expect(invalidRes.status).toBe(400);
    expect(await invalidRes.json()).toEqual({ error: 'invalid exchange request' });
  });

  it('handles expired grant', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'g1',
      jti: 'j1',
      token: 'tok',
      userId: 'u1',
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
    findUnique.mockResolvedValueOnce({
      id: 'g1',
      jti: 'j1',
      token: 'tok',
      userId: 'u1',
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
    findUnique.mockResolvedValueOnce({
      id: 'g1',
      jti: 'j1',
      token: 'token-1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null
    });
    update.mockResolvedValueOnce({});
    auditCreate.mockResolvedValueOnce({});
    transaction.mockResolvedValueOnce([{}, {}]);

    const res = await POST(
      buildReq({ code: 'abc123' }, { 'x-bridge-client': 'svc-a', 'x-bridge-secret': 'shared-secret' }) as never
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'token-1', token_type: 'Bearer' });
    expect(update).toHaveBeenCalled();
    expect(transaction).toHaveBeenCalled();
  });
});
