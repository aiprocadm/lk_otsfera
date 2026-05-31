import { describe, it, expect, beforeEach, vi } from 'vitest';

const { checkDbMock, checkRedisMock } = vi.hoisted(() => ({
  checkDbMock: vi.fn(),
  checkRedisMock: vi.fn()
}));
vi.mock('@/lib/health/checks', () => ({
  checkDb: checkDbMock,
  checkRedis: checkRedisMock
}));
// don't instantiate the real Prisma singleton — the route imports it but
// checkDb (mocked) never uses it
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { GET } from '@/app/api/health/route';

const TOKEN = 'test-health-token-0123456789-abcdefghij';

function req(authHeader?: string): Request {
  return new Request('http://localhost/api/health', {
    headers: authHeader ? { authorization: authHeader } : {}
  });
}

beforeEach(() => {
  process.env.HEALTH_TOKEN = TOKEN;
  checkDbMock.mockReset();
  checkRedisMock.mockReset();
  checkDbMock.mockResolvedValue({ ok: true, ms: 1 });
  checkRedisMock.mockResolvedValue({ ok: true, ms: 1 });
});

describe('GET /api/health (readiness)', () => {
  it('200 with checks when token valid and deps ok', async () => {
    const res = await GET(req(`Bearer ${TOKEN}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(true);
  });

  it('503 down when the db check fails', async () => {
    checkDbMock.mockResolvedValue({ ok: false, ms: 2001, error: 'timeout' });
    const res = await GET(req(`Bearer ${TOKEN}`) as never);
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('down');
  });

  it('503 when the redis check fails', async () => {
    checkRedisMock.mockResolvedValue({ ok: false, ms: 2001, error: 'timeout' });
    const res = await GET(req(`Bearer ${TOKEN}`) as never);
    expect(res.status).toBe(503);
  });

  it('401 when the token is missing (and does not run checks)', async () => {
    const res = await GET(req() as never);
    expect(res.status).toBe(401);
    expect(checkDbMock).not.toHaveBeenCalled();
  });

  it('401 when the token is wrong', async () => {
    const res = await GET(req('Bearer wrong-token') as never);
    expect(res.status).toBe(401);
  });

  it('503 health_token_unconfigured when HEALTH_TOKEN is unset', async () => {
    delete process.env.HEALTH_TOKEN;
    const res = await GET(req(`Bearer ${TOKEN}`) as never);
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe('health_token_unconfigured');
  });
});
