import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

const { chUpsert, chFindUnique, chUpdate, chDelete, bcFindFirst, bcUpdate, bcDeleteMany, bcCreateMany, txFn } =
  vi.hoisted(() => {
    const m = {
      chUpsert: vi.fn(),
      chFindUnique: vi.fn(),
      chUpdate: vi.fn(),
      chDelete: vi.fn(),
      bcFindFirst: vi.fn(),
      bcUpdate: vi.fn(),
      bcDeleteMany: vi.fn(),
      bcCreateMany: vi.fn(),
      txFn: vi.fn()
    };
    m.txFn.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({
        twoFactorChallenge: { upsert: m.chUpsert, findUnique: m.chFindUnique, update: m.chUpdate, delete: m.chDelete },
        twoFactorBackupCode: {
          findFirst: m.bcFindFirst,
          update: m.bcUpdate,
          deleteMany: m.bcDeleteMany,
          createMany: m.bcCreateMany
        }
      })
    );
    return m;
  });

const mockPrisma = {
  twoFactorChallenge: { upsert: chUpsert, findUnique: chFindUnique, update: chUpdate, delete: chDelete },
  twoFactorBackupCode: { findFirst: bcFindFirst, update: bcUpdate, deleteMany: bcDeleteMany, createMany: bcCreateMany },
  $transaction: txFn
} as unknown as import('@prisma/client').PrismaClient;

import { createTwoFactorChallenge, verifyTwoFactorCode, generateBackupCodes } from '@/lib/services/auth/twoFactor';

beforeEach(() => {
  vi.clearAllMocks();
  txFn.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb({
      twoFactorChallenge: { upsert: chUpsert, findUnique: chFindUnique, update: chUpdate, delete: chDelete },
      twoFactorBackupCode: { findFirst: bcFindFirst, update: bcUpdate, deleteMany: bcDeleteMany, createMany: bcCreateMany }
    })
  );
});

describe('createTwoFactorChallenge', () => {
  it('upserts a sha256-hashed 6-digit code with a ~10min expiry, attempts reset', async () => {
    chUpsert.mockResolvedValue(undefined);
    const before = Date.now();
    const { code } = await createTwoFactorChallenge(mockPrisma, 'u1');
    expect(code).toMatch(/^\d{6}$/);
    const arg = chUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 'u1' });
    expect(arg.create.codeHash).toBe(sha256(code));
    expect(arg.update.codeHash).toBe(sha256(code));
    expect(arg.update.attempts).toBe(0);
    const ttl = arg.create.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(10 * 60_000 - 100);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 1000);
  });
});

describe('verifyTwoFactorCode', () => {
  const FUTURE = new Date(Date.now() + 60_000);

  it('ok via challenge code; challenge deleted', async () => {
    chFindUnique.mockResolvedValue({ userId: 'u1', codeHash: sha256('123456'), expiresAt: FUTURE, attempts: 0 });
    const r = await verifyTwoFactorCode(mockPrisma, 'u1', '123456');
    expect(r).toEqual({ ok: true, method: 'challenge' });
    expect(chDelete).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('code_expired when no challenge', async () => {
    chFindUnique.mockResolvedValue(null);
    expect(await verifyTwoFactorCode(mockPrisma, 'u1', '123456')).toEqual({ ok: false, error: 'code_expired' });
  });

  it('code_expired when expiresAt in the past (challenge deleted)', async () => {
    chFindUnique.mockResolvedValue({
      userId: 'u1',
      codeHash: sha256('123456'),
      expiresAt: new Date(Date.now() - 1000),
      attempts: 0
    });
    expect(await verifyTwoFactorCode(mockPrisma, 'u1', '123456')).toEqual({ ok: false, error: 'code_expired' });
    expect(chDelete).toHaveBeenCalled();
  });

  it('too_many_attempts at 5 (challenge deleted)', async () => {
    chFindUnique.mockResolvedValue({ userId: 'u1', codeHash: sha256('123456'), expiresAt: FUTURE, attempts: 5 });
    expect(await verifyTwoFactorCode(mockPrisma, 'u1', '999999')).toEqual({ ok: false, error: 'too_many_attempts' });
    expect(chDelete).toHaveBeenCalled();
  });

  it('wrong code falls back to backup codes; hit consumes it', async () => {
    chFindUnique.mockResolvedValue({ userId: 'u1', codeHash: sha256('123456'), expiresAt: FUTURE, attempts: 0 });
    bcFindFirst.mockResolvedValue({ id: 'bc1' });
    const r = await verifyTwoFactorCode(mockPrisma, 'u1', 'BACKUPCODE');
    expect(r).toEqual({ ok: true, method: 'backup' });
    expect(bcFindFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', codeHash: sha256('BACKUPCODE'), usedAt: null },
      select: { id: true }
    });
    expect(bcUpdate).toHaveBeenCalledWith({ where: { id: 'bc1' }, data: { usedAt: expect.any(Date) } });
    expect(chDelete).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('both miss → invalid_code, attempts incremented', async () => {
    chFindUnique.mockResolvedValue({ userId: 'u1', codeHash: sha256('123456'), expiresAt: FUTURE, attempts: 1 });
    bcFindFirst.mockResolvedValue(null);
    expect(await verifyTwoFactorCode(mockPrisma, 'u1', '000000')).toEqual({ ok: false, error: 'invalid_code' });
    expect(chUpdate).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { attempts: { increment: 1 } } });
  });
});

describe('generateBackupCodes', () => {
  it('transactionally replaces old codes with 10 hashed new ones', async () => {
    const { codes } = await generateBackupCodes(mockPrisma, 'u1');
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(new Set(codes).size).toBe(10);
    expect(bcDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    const rows = bcCreateMany.mock.calls[0][0].data;
    expect(rows.map((r: { codeHash: string }) => r.codeHash)).toEqual(codes.map(sha256));
    expect(rows.every((r: { userId: string }) => r.userId === 'u1')).toBe(true);
  });
});
