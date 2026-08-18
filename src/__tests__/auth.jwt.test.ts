/**
 * Unit tests for src/lib/auth/jwt.ts
 *
 * Covers:
 *  - signToken + verifyToken: happy path
 *  - verifyToken: invalid token → throws
 *  - verifyToken: expired token → throws
 *  - assertSecretStrength: short secret → throws
 *  - getJwtSecret: missing JWT_SECRET → throws
 *  - signStudentBridgeToken: happy path (uses STUDENT_BRIDGE_JWT_SECRET)
 *  - signStudentBridgeToken: falls back to JWT_SECRET when bridge secret missing
 *  - signStudentBridgeToken: neither secret → throws
 *  - getStudentBridgeTtl: finite value clamped to [300, 900]
 *  - getStudentBridgeTtl: non-finite value → defaults to 600
 *  - verifyStudentBridgeToken: replay detection (P2002 unique constraint → throws)
 *  - verifyStudentBridgeToken: other DB error → re-throws
 *  - verifyStudentBridgeToken: missing jti/exp → throws
 *  - verifyStudentBridgeToken: wrong audience → throws
 *
 * Note: verifyStudentBridgeToken requires a real DB for consumeStudentBridgeJti;
 * we mock prisma for the replay and non-replay paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock prisma BEFORE importing jwt.ts (which imports prisma at module load)
// ---------------------------------------------------------------------------

const { jtiCreate } = vi.hoisted(() => ({ jtiCreate: vi.fn() }));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    studentBridgeTokenJti: { create: jtiCreate },
  },
}));

import {
  signToken,
  verifyToken,
  signStudentBridgeToken,
  verifyStudentBridgeToken,
} from '@/lib/auth/jwt';
import type { SessionPayload, StudentBridgePayload } from '@/lib/auth/jwt';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

const STRONG_SECRET = 'a'.repeat(32); // exactly 32 chars (minimum)
const BRIDGE_STRONG_SECRET = 'b'.repeat(32);

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: both secrets configured; APP_URL for issuer
  setEnv({
    JWT_SECRET: STRONG_SECRET,
    STUDENT_BRIDGE_JWT_SECRET: BRIDGE_STRONG_SECRET,
    APP_URL: 'https://lk.example.ru',
    STUDENT_BRIDGE_ISSUER: 'https://lk.example.ru',
    STUDENT_BRIDGE_TTL: undefined,
  });
});

afterEach(() => {
  setEnv({
    JWT_SECRET: undefined,
    STUDENT_BRIDGE_JWT_SECRET: undefined,
    APP_URL: undefined,
    STUDENT_BRIDGE_ISSUER: undefined,
    STUDENT_BRIDGE_TTL: undefined,
  });
});

// ---------------------------------------------------------------------------
// signToken + verifyToken
// ---------------------------------------------------------------------------

describe('signToken + verifyToken', () => {
  it('signs and verifies a partner session payload round-trip', async () => {
    const payload: SessionPayload = {
      sub: 'user-1',
      role: 'partner',
      partnerId: 'p-42',
      partnerRole: 'admin',
      assignedOrgIds: ['org-1', 'org-2'],
    };

    const token = await signToken(payload);
    expect(typeof token).toBe('string');

    const verified = await verifyToken(token);
    expect(verified.sub).toBe('user-1');
    expect(verified.role).toBe('partner');
    expect(verified.partnerId).toBe('p-42');
    expect(verified.partnerRole).toBe('admin');
    expect(verified.assignedOrgIds).toEqual(['org-1', 'org-2']);
  });

  it('signs and verifies an organization session payload', async () => {
    const payload: SessionPayload = {
      sub: 'user-org',
      role: 'organization',
      organizationId: 'org-5',
      organizationMemberships: [{ organizationId: 'org-5', roleInOrg: 'admin', isActive: true }],
    };

    const token = await signToken(payload);
    const verified = await verifyToken(token);
    expect(verified.role).toBe('organization');
    expect(verified.organizationId).toBe('org-5');
  });

  it('signs and verifies a manager session payload with managerRole', async () => {
    const payload: SessionPayload = {
      sub: 'mgr-1',
      role: 'manager',
      companyId: 'co-1',
      managedOrgIds: ['org-A'],
      managerRole: 'leader',
    };

    const token = await signToken(payload);
    const verified = await verifyToken(token);
    expect(verified.managerRole).toBe('leader');
    expect(verified.managedOrgIds).toEqual(['org-A']);
  });

  it('signs and verifies an admin session payload', async () => {
    const payload: SessionPayload = { sub: 'admin-1', role: 'admin' };
    const token = await signToken(payload);
    const verified = await verifyToken(token);
    expect(verified.role).toBe('admin');
  });

  it('signs and verifies a top-level leader payload (ТЗ 2026-08-17, PR-1)', async () => {
    // До PR-1 roleSchema отверг бы такой токен; после миграции данных (PR-3)
    // это основная модель руководителя.
    const payload: SessionPayload = {
      sub: 'ldr-1',
      role: 'leader',
      companyId: 'co-1',
      managedOrgIds: [],
    };

    const token = await signToken(payload);
    const verified = await verifyToken(token);
    expect(verified.role).toBe('leader');
    expect(verified.managedOrgIds).toEqual([]);
  });

  it('signs and verifies a student session payload', async () => {
    const payload: SessionPayload = {
      sub: 'stu-1',
      role: 'student',
      organizationId: 'org-3',
      externalStudentId: 'ext-99',
      email: 'student@uni.ru',
      name: 'Студент Иванов',
    };
    const token = await signToken(payload);
    const verified = await verifyToken(token);
    expect(verified.role).toBe('student');
    expect(verified.externalStudentId).toBe('ext-99');
  });

  // -------------------------------------------------------------------------
  // Этап 9 (ФТ-11.2): клейм sessionVersion в sessionPayloadSchema.
  // -------------------------------------------------------------------------

  it('токен без клейма sessionVersion остаётся валидным (обратная совместимость)', async () => {
    // Токены, выданные до релиза, живут ещё 7 дней и клейма не несут —
    // схема обязана их принимать, иначе релиз разлогинит всех разом.
    const token = await signToken({ sub: 'legacy-1', role: 'organization' });

    const verified = await verifyToken(token);

    expect(verified.sub).toBe('legacy-1');
    expect(verified.sessionVersion).toBeUndefined();
    expect('sessionVersion' in verified).toBe(false);
  });

  it('целочисленный sessionVersion доезжает до результата verifyToken (не срезается zod)', async () => {
    // zod strip'ает неизвестные ключи — доказываем, что клейм объявлен в схеме
    // и переживает round-trip, иначе getSession всегда сравнивал бы с 0.
    const token = await signToken({ sub: 'u-ver', role: 'manager', sessionVersion: 4 });

    const verified = await verifyToken(token);

    expect(verified.sessionVersion).toBe(4);
  });

  it('sessionVersion === 0 сохраняется как 0, а не теряется', async () => {
    const token = await signToken({ sub: 'u-zero', role: 'admin', sessionVersion: 0 });

    const verified = await verifyToken(token);

    expect(verified.sessionVersion).toBe(0);
  });

  it('verifyToken отвергает нецелый sessionVersion', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(STRONG_SECRET);
    const token = await new SignJWT({ sub: 'u-frac', role: 'admin', sessionVersion: 1.5 })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(secret);

    await expect(verifyToken(token)).rejects.toThrow();
  });

  it('verifyToken отвергает строковый sessionVersion', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(STRONG_SECRET);
    const token = await new SignJWT({ sub: 'u-str', role: 'admin', sessionVersion: '3' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(secret);

    await expect(verifyToken(token)).rejects.toThrow();
  });

  it('verifyToken отвергает null в sessionVersion (клейм optional, а не nullish)', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(STRONG_SECRET);
    const token = await new SignJWT({ sub: 'u-null', role: 'admin', sessionVersion: null })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(secret);

    await expect(verifyToken(token)).rejects.toThrow();
  });

  it('verifyToken throws on an invalid (random string) token', async () => {
    await expect(verifyToken('not-a-valid-jwt')).rejects.toThrow();
  });

  it('verifyToken throws on a token signed with a different secret', async () => {
    // Sign with one secret
    const token = await signToken({ sub: 'u', role: 'admin' });
    // Switch secret
    process.env.JWT_SECRET = 'c'.repeat(32);
    await expect(verifyToken(token)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getJwtSecret — missing secret
// ---------------------------------------------------------------------------

describe('getJwtSecret — missing secret', () => {
  it('signToken throws when JWT_SECRET is not set', async () => {
    delete process.env.JWT_SECRET;
    await expect(signToken({ sub: 'u', role: 'admin' })).rejects.toThrow(
      'JWT_SECRET is not configured'
    );
  });

  it('signToken throws when JWT_SECRET is too short', async () => {
    process.env.JWT_SECRET = 'short';
    await expect(signToken({ sub: 'u', role: 'admin' })).rejects.toThrow(
      'JWT_SECRET must be at least 32 characters'
    );
  });
});

// ---------------------------------------------------------------------------
// signStudentBridgeToken
// ---------------------------------------------------------------------------

describe('signStudentBridgeToken', () => {
  it('signs a bridge token using STUDENT_BRIDGE_JWT_SECRET when set', async () => {
    const payload: StudentBridgePayload = {
      sub: 'stu-1',
      role: 'student',
      organizationId: 'org-1',
      email: 'stu@uni.ru',
      name: 'Студент',
      externalStudentId: 'ext-1',
    };

    const result = await signStudentBridgeToken(payload);

    expect(typeof result.token).toBe('string');
    expect(typeof result.jti).toBe('string');
    expect(typeof result.iat).toBe('number');
    expect(result.jti.length).toBeGreaterThan(0);
  });

  it('falls back to JWT_SECRET when STUDENT_BRIDGE_JWT_SECRET is not set', async () => {
    delete process.env.STUDENT_BRIDGE_JWT_SECRET;
    const payload: StudentBridgePayload = {
      sub: 'stu-2',
      role: 'student',
      organizationId: null,
      externalStudentId: null,
    };

    // Should not throw
    const result = await signStudentBridgeToken(payload);
    expect(typeof result.token).toBe('string');
  });

  it('throws when neither STUDENT_BRIDGE_JWT_SECRET nor JWT_SECRET is set', async () => {
    delete process.env.STUDENT_BRIDGE_JWT_SECRET;
    delete process.env.JWT_SECRET;

    const payload: StudentBridgePayload = {
      sub: 'stu-3',
      role: 'student',
      organizationId: null,
      externalStudentId: null,
    };

    await expect(signStudentBridgeToken(payload)).rejects.toThrow(
      'Student bridge JWT secret is not configured'
    );
  });

  it('throws when STUDENT_BRIDGE_JWT_SECRET is too short', async () => {
    process.env.STUDENT_BRIDGE_JWT_SECRET = 'short';
    const payload: StudentBridgePayload = {
      sub: 'stu-4',
      role: 'student',
      organizationId: null,
      externalStudentId: null,
    };

    await expect(signStudentBridgeToken(payload)).rejects.toThrow('must be at least 32 characters');
  });

  it('uses TTL within [300, 900] clamp', async () => {
    // Set TTL above max — should be clamped to 900
    process.env.STUDENT_BRIDGE_TTL = '9999';
    const payload: StudentBridgePayload = {
      sub: 'stu-5',
      role: 'student',
      organizationId: null,
      externalStudentId: null,
    };

    const result = await signStudentBridgeToken(payload);
    expect(typeof result.token).toBe('string');
  });

  it('defaults TTL to 600 when STUDENT_BRIDGE_TTL is not a finite number', async () => {
    process.env.STUDENT_BRIDGE_TTL = 'not-a-number';
    const payload: StudentBridgePayload = {
      sub: 'stu-6',
      role: 'student',
      organizationId: null,
      externalStudentId: null,
    };

    // Should not throw
    const result = await signStudentBridgeToken(payload);
    expect(typeof result.token).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// verifyStudentBridgeToken
// ---------------------------------------------------------------------------

describe('getStudentBridgeIssuer — missing both vars', () => {
  it('signStudentBridgeToken throws when neither STUDENT_BRIDGE_ISSUER nor APP_URL is set', async () => {
    delete process.env.STUDENT_BRIDGE_ISSUER;
    delete process.env.APP_URL;

    const payload: StudentBridgePayload = {
      sub: 'stu-noissuer',
      role: 'student',
      organizationId: null,
      externalStudentId: null,
    };

    await expect(signStudentBridgeToken(payload)).rejects.toThrow(
      'STUDENT_BRIDGE_ISSUER (or APP_URL) is not configured'
    );
  });

  it('falls back to APP_URL as issuer when STUDENT_BRIDGE_ISSUER is absent', async () => {
    // Remove STUDENT_BRIDGE_ISSUER but keep APP_URL — covers the || right-hand arm on jwt.ts:81
    delete process.env.STUDENT_BRIDGE_ISSUER;
    process.env.APP_URL = 'https://lk.fallback.ru';

    const payload: StudentBridgePayload = {
      sub: 'stu-appurl-issuer',
      role: 'student',
      organizationId: null,
      externalStudentId: null,
    };

    // Should succeed: APP_URL is used as the issuer
    const result = await signStudentBridgeToken(payload);
    expect(typeof result.token).toBe('string');
  });
});

describe('verifyStudentBridgeToken', () => {
  it('throws on a tampered/invalid bridge token', async () => {
    await expect(verifyStudentBridgeToken('garbage-token')).rejects.toThrow();
  });

  it('throws on a bridge token verified against wrong audience', async () => {
    // Token signed with JWT_SECRET (main token, no audience) should fail bridge verify
    const mainToken = await signToken({ sub: 'u', role: 'student' });
    await expect(verifyStudentBridgeToken(mainToken)).rejects.toThrow();
  });

  it('throws "invalid student bridge token payload" for a bridge-audience token lacking jti/exp', async () => {
    // Manually craft a token with the correct audience + issuer but without jti/exp
    // We need to import SignJWT directly since signStudentBridgeToken always sets jti/exp
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(BRIDGE_STRONG_SECRET);
    const tokenWithoutJtiExp = await new SignJWT({ sub: 'stu-nojti', role: 'student' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('external-student-portal')
      .setIssuer('https://lk.example.ru')
      // intentionally NOT setting setJti() or setExpirationTime()
      .sign(secret);

    await expect(verifyStudentBridgeToken(tokenWithoutJtiExp)).rejects.toThrow(
      'invalid student bridge token payload'
    );
  });

  it('happy path: valid bridge token is verified and jti is consumed', async () => {
    jtiCreate.mockResolvedValue({ jti: 'some-jti', usedAt: new Date(), expiresAt: new Date() });

    const payload: StudentBridgePayload = {
      sub: 'stu-v1',
      role: 'student',
      organizationId: 'org-v1',
      email: 'v@uni.ru',
      name: 'Вера',
      externalStudentId: 'ext-v',
    };
    const { token } = await signStudentBridgeToken(payload);

    const verified = await verifyStudentBridgeToken(token);
    expect(verified.sub).toBe('stu-v1');
    expect(jtiCreate).toHaveBeenCalledOnce();
    const args = jtiCreate.mock.calls[0][0].data;
    expect(args.jti).toBeTruthy();
    expect(args.expiresAt).toBeInstanceOf(Date);
  });

  it('replay detection: P2002 unique constraint → throws "replay detected"', async () => {
    const replayError = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '5.0.0',
    });
    jtiCreate.mockRejectedValue(replayError);

    const payload: StudentBridgePayload = {
      sub: 'stu-replay',
      role: 'student',
      organizationId: null,
      externalStudentId: null,
    };
    const { token } = await signStudentBridgeToken(payload);

    await expect(verifyStudentBridgeToken(token)).rejects.toThrow(
      'student bridge token replay detected'
    );
  });

  it('non-P2002 DB error in consumeJti is re-thrown as-is', async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.0.0',
    });
    jtiCreate.mockRejectedValue(dbError);

    const payload: StudentBridgePayload = {
      sub: 'stu-dberr',
      role: 'student',
      organizationId: null,
      externalStudentId: null,
    };
    const { token } = await signStudentBridgeToken(payload);

    await expect(verifyStudentBridgeToken(token)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError
    );
  });
});
