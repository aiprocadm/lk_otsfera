import type { PrismaClient } from '@prisma/client';
import { normalizePhoneCanonical } from '@/lib/phone/normalize';

export type ResolveInput = {
  channel: 'telegram' | 'max' | 'whatsapp' | 'email';
  chatId?: string;
  phone?: string;
  email?: string;
};
export type ResolveResult =
  | { matchType: 'exact'; userId: string; orgId: string; companyId: string; orderId?: string; threadId?: string }
  | {
      matchType: 'unresolved';
      userId?: undefined;
      orgId?: undefined;
      companyId?: undefined;
      orderId?: undefined;
      threadId?: undefined;
    };

/** @deprecated use normalizePhoneCanonical; kept as a thin alias (M2 unification). */
export function normalizePhone(raw: string): string {
  return normalizePhoneCanonical(raw);
}

export async function resolveInboundSender(prisma: PrismaClient, input: ResolveInput): Promise<ResolveResult> {
  const where: Record<string, unknown> = {};
  if (input.channel === 'telegram' && input.chatId) where.telegramChatId = input.chatId;
  else if (input.channel === 'max' && input.chatId) where.maxChatId = input.chatId;
  else if (input.channel === 'whatsapp' && input.phone) where.whatsappPhone = normalizePhone(input.phone);
  else if (input.channel === 'email' && input.email) where.email = { equals: input.email.trim(), mode: 'insensitive' };
  else return { matchType: 'unresolved' };

  const users = await prisma.user.findMany({
    where,
    select: { id: true, organization: { select: { id: true, companyId: true } } },
    take: 2,
  });
  if (users.length !== 1) return { matchType: 'unresolved' };
  const u = users[0];
  if (!u.organization?.id || !u.organization.companyId) return { matchType: 'unresolved' };
  return { matchType: 'exact', userId: u.id, orgId: u.organization.id, companyId: u.organization.companyId };
}
