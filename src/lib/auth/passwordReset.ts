import { createHash, randomBytes } from 'crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const DEFAULT_INVITE_TTL_DAYS = 7;
const DEFAULT_RESET_TTL_HOURS = 2;

/**
 * `У-129`: сроки жизни ссылок настраиваются в интерфейсе. Приоритет прежний —
 * база → переменная сервера → умолчание; переменные из чтения не удалены.
 */
function ttlDaysFromEnv(): number {
  const raw = cachedIntegrationSetting('login.inviteTtlDays') ?? process.env.INVITE_TOKEN_TTL_DAYS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INVITE_TTL_DAYS;
}

function resetTtlHoursFromEnv(): number {
  const raw = cachedIntegrationSetting('login.resetTtlHours') ?? process.env.RESET_TOKEN_TTL_HOURS;
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
    data: { token: hashToken(token), userId, purpose, expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Смотрит назначение токена БЕЗ погашения (этап 4, ФТ-10.3): страница
 * `/reset-password` по нему различает «Добро пожаловать» (invite) и обычный
 * сброс. Невалидный/просроченный/погашенный токен → valid:false — страница
 * показывает нейтральный заголовок, а точную ошибку выдаст confirm-роут.
 */
export async function peekTokenPurpose(
  prisma: PrismaLike,
  token: string
): Promise<{ valid: boolean; purpose: 'invite' | 'reset' | null }> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { token: hashToken(token) },
    select: { purpose: true, usedAt: true, expiresAt: true },
  });
  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    return { valid: false, purpose: null };
  }
  return { valid: true, purpose: record.purpose === 'invite' ? 'invite' : 'reset' };
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
    // Этап 9 (ФТ-11.2): смена пароля (и активация по приглашению) отзывает все
    // ранее выданные токены — иначе перехваченная сессия переживает сброс.
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash: newPasswordHash, sessionVersion: { increment: 1 } },
    });
    await tx.passwordResetToken.update({
      where: { token: tokenHash },
      data: { usedAt: new Date() },
    });
    return { ok: true, userId: record.userId } as const;
  });
}
