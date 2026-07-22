import { randomBytes } from 'crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isTelegramEnabled, botDeepLink } from '@/lib/telegram/client';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { recordAudit } from '@/lib/auth/audit';

const LINK_CODE_EXPIRY_MINUTES = 15;

export async function getTelegramStatus(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; linked: boolean; enabled: boolean }> {
  await primeIntegrationSettingsCache(prisma);
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { telegramChatId: true },
  });
  return {
    ok: true,
    linked: !!user?.telegramChatId,
    enabled: isTelegramEnabled(),
  };
}

export async function generateLinkCode(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; deepLink: string } | { ok: false; error: 'telegram_disabled' }> {
  await primeIntegrationSettingsCache(prisma);
  if (!isTelegramEnabled()) {
    return { ok: false, error: 'telegram_disabled' };
  }

  const code = randomBytes(12).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_CODE_EXPIRY_MINUTES * 60 * 1000);

  await prisma.user.update({
    where: { id: session.sub },
    data: {
      telegramLinkCode: code,
      telegramLinkCodeExpiresAt: expiresAt,
    },
  });

  return { ok: true, deepLink: botDeepLink(code) };
}

export async function unlinkTelegram(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true }> {
  await prisma.user.update({
    where: { id: session.sub },
    data: {
      telegramChatId: null,
      telegramLinkCode: null,
      telegramLinkCodeExpiresAt: null,
    },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'telegram_unlinked',
    entity: 'user',
    entityId: session.sub,
  });

  return { ok: true };
}

export async function linkByCode(
  prisma: PrismaClient,
  args: { code: string; chatId: string }
): Promise<{ ok: true } | { ok: false; error: 'invalid_code' | 'chat_taken' }> {
  const user = await prisma.user.findFirst({
    where: {
      telegramLinkCode: args.code,
      telegramLinkCodeExpiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  if (!user) {
    return { ok: false, error: 'invalid_code' };
  }

  // Check if another user already has this chatId
  const existing = await prisma.user.findUnique({
    where: { telegramChatId: args.chatId },
    select: { id: true },
  });
  if (existing && existing.id !== user.id) {
    return { ok: false, error: 'chat_taken' };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: args.chatId,
        telegramLinkCode: null,
        telegramLinkCodeExpiresAt: null,
      },
    });
  } catch (err) {
    const prismaErr = err as Prisma.PrismaClientKnownRequestError;
    if (prismaErr?.code === 'P2002') {
      return { ok: false, error: 'chat_taken' };
    }
    throw err;
  }

  await recordAudit(prisma, {
    userId: user.id,
    action: 'telegram_linked',
    entity: 'user',
    entityId: user.id,
    // Intentionally not logging the code (§12 security rule)
  });

  return { ok: true };
}
