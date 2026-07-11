import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTwoFactorChallenge, verifyTwoFactorCode, generateBackupCodes } from '@/lib/services/auth/twoFactor';

let prisma: PrismaClient;
let userId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const u = await prisma.user.create({
    data: { email: `2fa-${Date.now()}@t.local`, passwordHash: 'x', name: '2FA T', role: 'manager' }
  });
  userId = u.id;
});

afterAll(async () => {
  await prisma.twoFactorChallenge.deleteMany({ where: { userId } });
  await prisma.twoFactorBackupCode.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('twoFactor service (integration)', () => {
  it('create → verify happy path; challenge row is consumed', async () => {
    const { code } = await createTwoFactorChallenge(prisma, userId);
    expect(await verifyTwoFactorCode(prisma, userId, code)).toEqual({ ok: true, method: 'challenge' });
    expect(await prisma.twoFactorChallenge.findUnique({ where: { userId } })).toBeNull();
  });

  it('re-login overwrites the previous challenge (single row per user)', async () => {
    const first = await createTwoFactorChallenge(prisma, userId);
    const second = await createTwoFactorChallenge(prisma, userId);
    // Старый код мёртв после перезаписи (если коды случайно не совпали)
    if (first.code !== second.code) {
      expect(await verifyTwoFactorCode(prisma, userId, first.code)).toEqual({ ok: false, error: 'invalid_code' });
    }
    const rows = await prisma.twoFactorChallenge.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    await prisma.twoFactorChallenge.deleteMany({ where: { userId } });
  });

  it('5 wrong attempts kill the challenge', async () => {
    const { code } = await createTwoFactorChallenge(prisma, userId);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await verifyTwoFactorCode(prisma, userId, wrong)).ok).toBe(false);
    }
    expect(await verifyTwoFactorCode(prisma, userId, wrong)).toEqual({ ok: false, error: 'too_many_attempts' });
    expect(await prisma.twoFactorChallenge.findUnique({ where: { userId } })).toBeNull();
  });

  it('backup code works once; regeneration invalidates old codes', async () => {
    const { codes } = await generateBackupCodes(prisma, userId);
    await createTwoFactorChallenge(prisma, userId);
    expect(await verifyTwoFactorCode(prisma, userId, codes[0]!)).toEqual({ ok: true, method: 'backup' });

    // Повторное использование того же backup-кода — отказ
    await createTwoFactorChallenge(prisma, userId);
    expect(await verifyTwoFactorCode(prisma, userId, codes[0]!)).toEqual({ ok: false, error: 'invalid_code' });

    // Перегенерация инвалидирует ВСЕ старые коды
    const { codes: fresh } = await generateBackupCodes(prisma, userId);
    expect(await verifyTwoFactorCode(prisma, userId, codes[1]!)).toEqual({ ok: false, error: 'invalid_code' });
    expect(await verifyTwoFactorCode(prisma, userId, fresh[0]!)).toEqual({ ok: true, method: 'backup' });
  });
});
