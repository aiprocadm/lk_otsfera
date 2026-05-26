import { randomBytes } from 'crypto';
import type { PrismaClient, Prisma } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const DEFAULT_TTL_DAYS = 7;

function ttlDaysFromEnv(): number {
  const raw = process.env.INVITE_TOKEN_TTL_DAYS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_DAYS;
}

export async function createInviteToken(
  prisma: PrismaLike,
  userId: string,
  ttlDays?: number,
  purpose: 'invite' | 'reset' = 'invite'
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const effectiveTtl = ttlDays ?? ttlDaysFromEnv();
  const expiresAt = new Date(Date.now() + effectiveTtl * 24 * 60 * 60 * 1000);
  await prisma.passwordResetToken.create({
    data: { token, userId, purpose, expiresAt }
  });
  return { token, expiresAt };
}

export async function verifyAndConsumeToken(
  prisma: PrismaClient,
  token: string,
  newPasswordHash: string
): Promise<{ ok: true; userId: string } | { ok: false; reason: 'not_found' | 'expired' | 'used' }> {
  return prisma.$transaction(async (tx) => {
    const record = await tx.passwordResetToken.findUnique({ where: { token } });
    if (!record) return { ok: false, reason: 'not_found' } as const;
    if (record.usedAt) return { ok: false, reason: 'used' } as const;
    if (record.expiresAt <= new Date()) return { ok: false, reason: 'expired' } as const;
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash: newPasswordHash } });
    await tx.passwordResetToken.update({ where: { token }, data: { usedAt: new Date() } });
    return { ok: true, userId: record.userId } as const;
  });
}
