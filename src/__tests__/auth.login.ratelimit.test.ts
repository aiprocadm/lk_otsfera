/**
 * Tests the login rate-limiter (429) path.
 *
 * The loginAttempts Map is module-level state shared across all requests to
 * the same IP within the same module instance. We exhaust the default limit
 * (10) by firing 11 requests from the same IP, then assert the 11th is 429.
 *
 * We use a dedicated IP prefix so this file's requests don't collide with
 * the other login test files (which each get a fresh module instance).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUnique, updateUser, compare, signToken } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateUser: vi.fn(),
  compare: vi.fn(),
  signToken: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    // updateUser — отметка lastLoginAt (этап 9, ФТ-11.3)
    user: { findUnique, update: updateUser },
    partnerUser: { findUnique: vi.fn().mockResolvedValue(null) }
  }
}));
vi.mock('bcryptjs', () => ({ default: { compare } }));
vi.mock('@/lib/auth/jwt', () => ({ signToken }));

import { POST } from '@/app/api/auth/login/route';

function makeReq(body: object, ip = '1.2.3.4') {
  return new Request('https://app.local/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip
    }
  });
}

const adminUser = {
  id: 'u1', role: 'admin', companyId: null, partnerId: null,
  organizationId: null, email: 'admin@example.com', name: 'Admin',
  externalStudentId: null, passwordHash: 'hash', managerRole: null
};

beforeEach(() => {
  vi.resetAllMocks();
  compare.mockResolvedValue(true);
  signToken.mockResolvedValue('tok');
  findUnique.mockResolvedValue(adminUser);
  updateUser.mockResolvedValue({});
});

describe('login rate limiting', () => {
  it('allows normal requests (first 10 succeed)', async () => {
    const res = await POST(makeReq({ email: 'admin@example.com', password: 'x' }, '192.0.2.1'));
    expect(res.status).toBe(200);
  });

  it('returns 429 when the same IP exceeds 10 requests in the window', async () => {
    const ip = '192.0.2.99';
    // Fire 10 requests to fill the bucket (MAX_ATTEMPTS = 10 by default)
    for (let i = 0; i < 10; i++) {
      await POST(makeReq({ email: 'admin@example.com', password: 'x' }, ip));
    }
    // The 11th request should be rate-limited (count=11 > 10)
    const res = await POST(makeReq({ email: 'admin@example.com', password: 'x' }, ip));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('TOO_MANY_REQUESTS');
  });
});
