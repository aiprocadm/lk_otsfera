import { createHash, randomBytes } from 'crypto';
import type { PrismaClient, Prisma } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const DEFAULT_INVITE_TTL_DAYS = 7;
const DEFAULT_RESET_TTL_HOURS = 2;

function ttlDaysFromEnv(): number {
  const raw = process.env.INVITE_TOKEN_TTL_DAYS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INVITE_TTL_DAYS;
}

function resetTtlHoursFromEnv(): number {
  const raw = process.env.RESET_TOKEN_TTL_HOURS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESET_TTL_HOURS;
}

// В БД хранится только sha256-хеш: дамп/чтение таблицы не позволяет собрать
// рабочую ссылку сброса пароля. Плейнтекст живёт только в письме пользователя.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createInviteToken(
  prisma: PrismaLike,
  userId: string,
  ttlDays?: number,
  purpose: 'invite' | 'reset' = 'invite'
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  // reset — короткоживущий (часы): окно перехвата ссылки должно быть узким.
  // invite — дни: письмо может ждать адресата в ящике.
  const ttlMs =
    ttlDays != null
      ? ttlDays * 24 * 60 * 60 * 1000
      : purpose === 'reset'
        ? resetTtlHoursFromEnv() * 60 * 60 * 1000
        : ttlDaysFromEnv() * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.passwordResetToken.create({
    data: { token: hashToken(token), userId, purpose, expiresAt }
  });
  return { token, expiresAt };
}

export async function verifyAndConsumeToken(
  prisma: PrismaClient,
  token: string,
  newPasswordHash: string
): Promise<{ ok: true; userId: string } | { ok: false; reason: 'not_found' | 'expired' | 'used' }> {
  const tokenHash = hashToken(token);
  return prisma.$transaction(async (tx) => {
    const record = await tx.passwordResetToken.findUnique({ where: { token: tokenHash } });
    if (!record) return { ok: false, reason: 'not_found' } as const;
    if (record.usedAt) return { ok: false, reason: 'used' } as const;
    if (record.expiresAt <= new Date()) return { ok: false, reason: 'expired' } as const;
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash: newPasswordHash } });
    await tx.passwordResetToken.update({ where: { token: tokenHash }, data: { usedAt: new Date() } });
    return { ok: true, userId: record.userId } as const;
  });
}
