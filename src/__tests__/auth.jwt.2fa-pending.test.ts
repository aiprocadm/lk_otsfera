import { describe, it, expect, beforeAll } from 'vitest';
import {
  signToken,
  signTwoFactorPendingToken,
  verifyTwoFactorPendingToken,
  verifyToken
} from '@/lib/auth/jwt';

beforeAll(() => {
  process.env.JWT_SECRET = 'unit-test-secret-that-is-32-chars!!';
});

describe('two-factor pending token', () => {
  it('round-trips sub through sign/verify', async () => {
    const token = await signTwoFactorPendingToken('user-1');
    const claims = await verifyTwoFactorPendingToken(token);
    expect(claims.sub).toBe('user-1');
  });

  it('GUARD: pre-auth token is NOT a valid session token', async () => {
    // Подложенный в cookie `session` pre-auth токен обязан отвергаться:
    // в нём нет role, а sessionPayloadSchema требует role.
    const token = await signTwoFactorPendingToken('user-1');
    await expect(verifyToken(token)).rejects.toThrow();
  });

  it('rejects a session token passed as a pending token (purpose mismatch)', async () => {
    const session = await signToken({ sub: 'user-1', role: 'manager' });
    await expect(verifyTwoFactorPendingToken(session)).rejects.toThrow();
  });

  it('rejects garbage', async () => {
    await expect(verifyTwoFactorPendingToken('not-a-jwt')).rejects.toThrow();
  });
});
