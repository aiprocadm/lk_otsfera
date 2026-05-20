import { describe, expect, it, vi, beforeEach } from 'vitest';

const { upsert } = vi.hoisted(() => ({
  upsert: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    studentBridgeTokenJti: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert
    }
  }
}));

import { signStudentBridgeToken, verifyStudentBridgeToken } from '@/lib/auth/jwt';
import { assertAllowedStudentPortalUrl } from '@/lib/security/redirect';

describe('student bridge token and redirect', () => {
  beforeEach(() => {
    process.env.STUDENT_BRIDGE_JWT_SECRET = 'bridge-secret';
    process.env.STUDENT_BRIDGE_ISSUER = 'https://issuer.local';
    process.env.STUDENT_BRIDGE_TTL = '600';
  });

  it('token has aud/iss/jti/exp and ttl in allowed range', async () => {
    const { token, iat } = await signStudentBridgeToken({
      sub: 'u1',
      role: 'student',
      organizationId: 'o1',
      email: 'a@b.c',
      name: 'N',
      externalStudentId: 's1'
    });
    const payload = await verifyStudentBridgeToken(token);
    expect(payload.aud).toBe('external-student-portal');
    expect(payload.iss).toBe('https://issuer.local');
    expect(payload.jti).toBeTruthy();
    expect(payload.exp).toBeTruthy();
    expect(payload.exp! - iat).toBeGreaterThanOrEqual(300);
    expect(payload.exp! - iat).toBeLessThanOrEqual(900);
    expect(upsert).toHaveBeenCalled();
  });

  it('redirect allows only allowlisted domain', () => {
    expect(() => assertAllowedStudentPortalUrl('https://otsfera.cdoprof.com/path')).not.toThrow();
    expect(() => assertAllowedStudentPortalUrl('https://evil.local/path')).toThrow();
  });
});
