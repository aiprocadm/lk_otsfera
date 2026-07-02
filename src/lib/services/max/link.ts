/**
 * Привязка аккаунта Max к пользователю (D3) — зеркало services/telegram/link.
 * Deep-link + одноразовый код, webhook ловит `/start <code>`. Result-контракт §3.
 */
import { randomBytes } from 'crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isMaxEnabled, maxDeepLink } from '@/lib/max/client';
import { recordAudit } from '@/lib/auth/audit';

const LINK_CODE_EXPIRY_MINUTES = 15;

export async function getMaxStatus(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; linked: boolean; enabled: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { maxChatId: true },
  });
  return {
    ok: true,
    linked: !!user?.maxChatId,
    enabled: isMaxEnabled(),
  };
}

export async function generateMaxLinkCode(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; deepLink: string } | { ok: false; error: 'max_disabled' }> {
  if (!isMaxEnabled()) {
    return { ok: false, error: 'max_disabled' };
  }

  const code = randomBytes(12).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_CODE_EXPIRY_MINUTES * 60 * 1000);

  await prisma.user.update({
    where: { id: session.sub },
    data: {
      maxLinkCode: code,
      maxLinkCodeExpiresAt: expiresAt,
    },
  });

  return { ok: true, deepLink: maxDeepLink(code) };
}

export async function unlinkMax(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true }> {
  await prisma.user.update({
    where: { id: session.sub },
    data: {
      maxChatId: null,
      maxLinkCode: null,
      maxLinkCodeExpiresAt: null,
    },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'max_unlinked',
    entity: 'user',
    entityId: session.sub,
  });

  return { ok: true };
}

export async function linkMaxByCode(
  prisma: PrismaClient,
  args: { code: string; chatId: string }
): Promise<{ ok: true } | { ok: false; error: 'invalid_code' | 'chat_taken' }> {
  const user = await prisma.user.findFirst({
    where: {
      maxLinkCode: args.code,
      maxLinkCodeExpiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

  if (!user) {
    return { ok: false, error: 'invalid_code' };
  }

  const existing = await prisma.user.findUnique({
    where: { maxChatId: args.chatId },
    select: { id: true },
  });
  if (existing && existing.id !== user.id) {
    return { ok: false, error: 'chat_taken' };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        maxChatId: args.chatId,
        maxLinkCode: null,
        maxLinkCodeExpiresAt: null,
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
    action: 'max_linked',
    entity: 'user',
    entityId: user.id,
    // Код привязки намеренно не логируется (§12 security rule).
  });

  return { ok: true };
}
