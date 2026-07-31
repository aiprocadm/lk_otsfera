import { createHash, randomBytes, randomInt } from 'crypto';
import type { PrismaClient } from '@prisma/client';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BACKUP_COUNT = 10;
const BACKUP_LEN = 10;
// base32-подобный алфавит без похожих глифов (0/O, 1/I/L) — коды диктуются голосом
const BACKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// В БД — только sha256 (тот же принцип, что reset-токены c3ab030): дамп/чтение
// таблицы не даёт рабочих кодов. KDF не нужен: коды короткоживущие (challenge)
// либо высокоэнтропийные (backup, 31^10).
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export type VerifyTwoFactorResult =
  | { ok: true; method: 'challenge' | 'backup' }
  | { ok: false; error: 'code_expired' | 'too_many_attempts' | 'invalid_code' };

export async function createTwoFactorChallenge(
  prisma: PrismaClient,
  userId: string
): Promise<{ code: string }> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await prisma.twoFactorChallenge.upsert({
    where: { userId },
    create: { userId, codeHash: hashCode(code), expiresAt },
    update: { codeHash: hashCode(code), expiresAt, attempts: 0 },
  });
  return { code };
}

export async function verifyTwoFactorCode(
  prisma: PrismaClient,
  userId: string,
  code: string
): Promise<VerifyTwoFactorResult> {
  const challenge = await prisma.twoFactorChallenge.findUnique({ where: { userId } });
  if (!challenge) return { ok: false, error: 'code_expired' };
  if (challenge.expiresAt <= new Date()) {
    await prisma.twoFactorChallenge.delete({ where: { userId } });
    return { ok: false, error: 'code_expired' };
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    await prisma.twoFactorChallenge.delete({ where: { userId } });
    return { ok: false, error: 'too_many_attempts' };
  }
  // Сравниваются sha256-хеши, а не сами секреты: тайминг === не раскрывает
  // префикс кода (хеш непредсказуем), constant-time здесь не требуется.
  if (hashCode(code) === challenge.codeHash) {
    await prisma.twoFactorChallenge.delete({ where: { userId } });
    return { ok: true, method: 'challenge' };
  }
  // Fallback: backup-код (одноразовый). Идёт только при живой challenge —
  // backup-код вне логин-флоу бесполезен.
  const backup = await prisma.twoFactorBackupCode.findFirst({
    where: { userId, codeHash: hashCode(code), usedAt: null },
    select: { id: true },
  });
  if (backup) {
    await prisma.twoFactorBackupCode.update({
      where: { id: backup.id },
      data: { usedAt: new Date() },
    });
    await prisma.twoFactorChallenge.delete({ where: { userId } });
    return { ok: true, method: 'backup' };
  }
  await prisma.twoFactorChallenge.update({
    where: { userId },
    data: { attempts: { increment: 1 } },
  });
  return { ok: false, error: 'invalid_code' };
}

function randomBackupCode(): string {
  const bytes = randomBytes(BACKUP_LEN);
  let out = '';
  for (let i = 0; i < BACKUP_LEN; i++) out += BACKUP_ALPHABET[bytes[i]! % BACKUP_ALPHABET.length];
  return out;
}

export async function generateBackupCodes(
  prisma: PrismaClient,
  userId: string
): Promise<{ codes: string[] }> {
  const codes = Array.from({ length: BACKUP_COUNT }, () => randomBackupCode());
  await prisma.$transaction(async (tx) => {
    await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
    await tx.twoFactorBackupCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: hashCode(c) })),
    });
  });
  return { codes };
}
