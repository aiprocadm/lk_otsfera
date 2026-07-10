import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// ---------------------------------------------------------------------------
// Mock helpers hoisted so they are available before module imports
// ---------------------------------------------------------------------------
const { prtCreate, prtFindUnique, prtUpdate, userUpdate, txFn } = vi.hoisted(() => {
  const prtCreate = vi.fn();
  const prtFindUnique = vi.fn();
  const prtUpdate = vi.fn();
  const userUpdate = vi.fn();

  // $transaction executes the callback synchronously with a mock tx object
  const txFn = vi.fn((cb: (tx: unknown) => unknown) =>
    cb({
      passwordResetToken: { findUnique: prtFindUnique, update: prtUpdate },
      user: { update: userUpdate }
    })
  );

  return { prtCreate, prtFindUnique, prtUpdate, userUpdate, txFn };
});

// Build a mock PrismaClient that the module under test will receive directly
const mockPrisma = {
  passwordResetToken: { create: prtCreate, findUnique: prtFindUnique },
  $transaction: txFn
} as unknown as import('@prisma/client').PrismaClient;

import { createInviteToken, verifyAndConsumeToken } from '@/lib/auth/passwordReset';

// ---------------------------------------------------------------------------
// createInviteToken
// ---------------------------------------------------------------------------
describe('createInviteToken', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    txFn.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({
        passwordResetToken: { findUnique: prtFindUnique, update: prtUpdate },
        user: { update: userUpdate }
      })
    );
    prtCreate.mockResolvedValue(undefined);
  });

  it('creates a token record and returns token + expiresAt', async () => {
    const result = await createInviteToken(mockPrisma, 'user-1', 7);

    expect(prtCreate).toHaveBeenCalledOnce();
    const callArg = prtCreate.mock.calls[0][0];
    expect(callArg.data.userId).toBe('user-1');
    expect(callArg.data.purpose).toBe('invite');
    expect(callArg.data.token).toBeTypeOf('string');
    expect(callArg.data.expiresAt).toBeInstanceOf(Date);

    // В БД уходит sha256-хеш, наружу — плейнтекст (живёт только в письме).
    expect(result.token.length).toBeGreaterThan(20);
    expect(callArg.data.token).toBe(sha256(result.token));
    expect(callArg.data.token).not.toBe(result.token);
    expect(result.expiresAt).toEqual(callArg.data.expiresAt);
  });

  it('uses env-var TTL when ttlDays is not provided', async () => {
    process.env.INVITE_TOKEN_TTL_DAYS = '3';
    const before = Date.now();
    const result = await createInviteToken(mockPrisma, 'user-2');
    const after = Date.now();
    delete process.env.INVITE_TOKEN_TTL_DAYS;

    const diffMs = result.expiresAt.getTime() - before;
    const expectedMs = 3 * 24 * 60 * 60 * 1000;
    expect(diffMs).toBeGreaterThanOrEqual(expectedMs - 100);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  it('falls back to 7 days when env var is absent or invalid', async () => {
    delete process.env.INVITE_TOKEN_TTL_DAYS;
    const before = Date.now();
    const result = await createInviteToken(mockPrisma, 'user-3');
    const after = Date.now();

    const diffMs = result.expiresAt.getTime() - before;
    const expectedMs = 7 * 24 * 60 * 60 * 1000;
    expect(diffMs).toBeGreaterThanOrEqual(expectedMs - 100);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  it("purpose='reset' defaults to a short 2-hour TTL", async () => {
    delete process.env.RESET_TOKEN_TTL_HOURS;
    const before = Date.now();
    const result = await createInviteToken(mockPrisma, 'user-4', undefined, 'reset');
    const after = Date.now();

    const callArg = prtCreate.mock.calls[0][0];
    expect(callArg.data.purpose).toBe('reset');
    const diffMs = result.expiresAt.getTime() - before;
    const expectedMs = 2 * 60 * 60 * 1000;
    expect(diffMs).toBeGreaterThanOrEqual(expectedMs - 100);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  it("purpose='reset' honours RESET_TOKEN_TTL_HOURS", async () => {
    process.env.RESET_TOKEN_TTL_HOURS = '1';
    const before = Date.now();
    const result = await createInviteToken(mockPrisma, 'user-5', undefined, 'reset');
    const after = Date.now();
    delete process.env.RESET_TOKEN_TTL_HOURS;

    const diffMs = result.expiresAt.getTime() - before;
    const expectedMs = 60 * 60 * 1000;
    expect(diffMs).toBeGreaterThanOrEqual(expectedMs - 100);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  it('explicit ttlDays wins over the reset default', async () => {
    const before = Date.now();
    const result = await createInviteToken(mockPrisma, 'user-6', 1, 'reset');
    const after = Date.now();

    const diffMs = result.expiresAt.getTime() - before;
    const expectedMs = 24 * 60 * 60 * 1000;
    expect(diffMs).toBeGreaterThanOrEqual(expectedMs - 100);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });
});

// ---------------------------------------------------------------------------
// verifyAndConsumeToken
// ---------------------------------------------------------------------------
describe('verifyAndConsumeToken', () => {
  const FUTURE = new Date(Date.now() + 1000 * 60 * 60 * 24);
  const PAST = new Date(Date.now() - 1000);

  beforeEach(() => {
    vi.resetAllMocks();
    txFn.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({
        passwordResetToken: { findUnique: prtFindUnique, update: prtUpdate },
        user: { update: userUpdate }
      })
    );
  });

  it('happy path: updates password and marks token used (lookup by sha256)', async () => {
    prtFindUnique.mockResolvedValue({
      token: sha256('tok'),
      userId: 'user-1',
      expiresAt: FUTURE,
      usedAt: null
    });
    prtUpdate.mockResolvedValue(undefined);
    userUpdate.mockResolvedValue(undefined);

    const result = await verifyAndConsumeToken(mockPrisma, 'tok', 'hash-new');

    expect(result).toEqual({ ok: true, userId: 'user-1' });
    // И поиск, и consume идут по хешу — плейнтекст в БД не попадает.
    expect(prtFindUnique).toHaveBeenCalledWith({ where: { token: sha256('tok') } });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'hash-new' }
    });
    expect(prtUpdate).toHaveBeenCalledWith({
      where: { token: sha256('tok') },
      data: { usedAt: expect.any(Date) }
    });
  });

  it('returns not_found when token does not exist', async () => {
    prtFindUnique.mockResolvedValue(null);

    const result = await verifyAndConsumeToken(mockPrisma, 'missing', 'hash');

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(prtUpdate).not.toHaveBeenCalled();
  });

  it('returns expired when token expiresAt is in the past', async () => {
    prtFindUnique.mockResolvedValue({
      token: 'tok',
      userId: 'user-1',
      expiresAt: PAST,
      usedAt: null
    });

    const result = await verifyAndConsumeToken(mockPrisma, 'tok', 'hash');

    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('returns used when token already has usedAt set', async () => {
    prtFindUnique.mockResolvedValue({
      token: 'tok',
      userId: 'user-1',
      expiresAt: FUTURE,
      usedAt: new Date()
    });

    const result = await verifyAndConsumeToken(mockPrisma, 'tok', 'hash');

    expect(result).toEqual({ ok: false, reason: 'used' });
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
