import type { PrismaClient, ContactChannelType } from '@prisma/client';
import { normalizePhoneCanonical } from '@/lib/phone/normalize';
import { resolveContactByChannel } from '@/lib/services/contacts/resolveContactByChannel';

export type ResolveInput = {
  channel: 'telegram' | 'max' | 'whatsapp' | 'email';
  chatId?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
};
export type ResolveResult =
  | {
      matchType: 'exact';
      userId?: string | undefined;
      orgId: string;
      companyId: string;
      contactId?: string | undefined;
      orderId?: string | undefined;
      threadId?: string | undefined;
    }
  | {
      matchType: 'unresolved';
      userId?: undefined;
      orgId?: undefined;
      companyId?: undefined;
      contactId?: undefined;
      orderId?: undefined;
      threadId?: undefined;
    };

/** @deprecated use normalizePhoneCanonical; kept as a thin alias (M2 unification). */
export function normalizePhone(raw: string): string {
  return normalizePhoneCanonical(raw);
}

const CHANNEL_TYPE: Record<ResolveInput['channel'], ContactChannelType> = {
  telegram: 'telegram',
  max: 'max',
  whatsapp: 'whatsapp',
  email: 'email',
};

export async function resolveInboundSender(
  prisma: PrismaClient,
  input: ResolveInput
): Promise<ResolveResult> {
  // 1) Contact-first: prefer a ContactChannel match over the legacy User exact-match.
  // An org-less contact hit does NOT short-circuit — inbound needs an org to bind, so
  // it falls through to the User path below.
  const value = input.chatId ?? input.phone ?? input.email;
  if (value) {
    const hit = await resolveContactByChannel(prisma, { type: CHANNEL_TYPE[input.channel], value });
    if (hit && hit.organizationId) {
      return {
        matchType: 'exact',
        orgId: hit.organizationId,
        companyId: hit.companyId,
        contactId: hit.contactId,
        ...(hit.userId ? { userId: hit.userId } : {}),
      };
    }
  }

  // 2) Existing User exact-match fallback (unchanged).
  const where: Record<string, unknown> = {};
  if (input.channel === 'telegram' && input.chatId) where.telegramChatId = input.chatId;
  else if (input.channel === 'max' && input.chatId) where.maxChatId = input.chatId;
  else if (input.channel === 'whatsapp' && input.phone)
    where.whatsappPhone = normalizePhone(input.phone);
  else if (input.channel === 'email' && input.email)
    where.email = { equals: input.email.trim(), mode: 'insensitive' };
  else return { matchType: 'unresolved' };

  const users = await prisma.user.findMany({
    where,
    select: { id: true, organization: { select: { id: true, companyId: true } } },
    take: 2,
  });
  if (users.length !== 1) return { matchType: 'unresolved' };
  const u = users[0];
  if (!u.organization?.id || !u.organization.companyId) return { matchType: 'unresolved' };
  return {
    matchType: 'exact',
    userId: u.id,
    orgId: u.organization.id,
    companyId: u.organization.companyId,
    contactId: undefined,
  };
}
