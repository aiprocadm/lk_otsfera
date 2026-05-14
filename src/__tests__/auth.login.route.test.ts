import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, compare, signToken } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  compare: vi.fn(),
  signToken: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique } } }));
vi.mock('bcryptjs', () => ({ default: { compare } }));
vi.mock('@/lib/auth/jwt', () => ({ signToken }));

import { POST } from '@/app/api/auth/login/route';

describe('auth login route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 400 for invalid JSON payload', async () => {
    const res = await POST(new Request('https://app.local/api/auth/login', {
      method: 'POST',
      body: '{bad-json',
      headers: { 'content-type': 'application/json' }
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      code: 'INVALID_REQUEST',
      message: 'Invalid request'
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 for empty fields', async () => {
    const res = await POST(new Request('https://app.local/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: '', password: '' }),
      headers: { 'content-type': 'application/json' }
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      code: 'INVALID_REQUEST',
      message: 'Invalid request'
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns 200 and sets cookie for valid credentials', async () => {
    findUnique.mockResolvedValue({
      id: 'u1',
      role: 'admin',
      companyId: 'c1',
      partnerId: null,
      organizationId: null,
      email: 'user@example.com',
      name: 'User',
      externalStudentId: null,
      passwordHash: 'hash'
    });
    compare.mockResolvedValue(true);
    signToken.mockResolvedValue('signed-token');

    const res = await POST(new Request('https://app.local/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com', password: 'secret' }),
      headers: { 'content-type': 'application/json' }
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'user@example.com' } });
    expect(compare).toHaveBeenCalledWith('secret', 'hash');
    expect(signToken).toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toContain('session=signed-token');
  });
});
