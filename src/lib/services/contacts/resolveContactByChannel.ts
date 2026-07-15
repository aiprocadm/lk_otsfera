import type { PrismaClient, ContactChannelType } from '@prisma/client';
import { normalizePhoneCanonical } from '@/lib/phone/normalize';

export type ChannelResolution = {
  contactId: string;
  organizationId: string | null;
  companyId: string;
  userId?: string;
};

/** Normalize a raw channel value the same way it is stored. */
export function normalizeChannelValue(type: ContactChannelType, value: string): string {
  if (type === 'phone' || type === 'whatsapp') return normalizePhoneCanonical(value);
  if (type === 'email') return value.trim().toLowerCase();
  return value.trim(); // telegram/max: chatId as-is
}

/**
 * Resolve a communication identity to a Contact via ContactChannel. Exactly-one
 * or null (ambiguous/absent → null; never guesses). `phoneLike` widens a voice-call
 * lookup to both {phone, whatsapp} (same number space).
 */
export async function resolveContactByChannel(
  prisma: PrismaClient,
  input: { type: ContactChannelType; value: string; phoneLike?: boolean }
): Promise<ChannelResolution | null> {
  const normalizedValue = normalizeChannelValue(input.type, input.value);
  if (!normalizedValue) return null;
  const typeFilter = input.phoneLike ? { in: ['phone', 'whatsapp'] as ContactChannelType[] } : input.type;

  const rows = await prisma.contactChannel.findMany({
    where: { type: typeFilter, normalizedValue, contact: { is: { isArchived: false } } },
    select: {
      contact: {
        select: { id: true, organizationId: true, companyId: true, userId: true, isArchived: true },
      },
    },
    take: 2,
  });
  const live = rows.filter((r) => !r.contact.isArchived);
  if (live.length !== 1) return null;
  const c = live[0].contact;
  return { contactId: c.id, organizationId: c.organizationId, companyId: c.companyId, ...(c.userId ? { userId: c.userId } : {}) };
}
