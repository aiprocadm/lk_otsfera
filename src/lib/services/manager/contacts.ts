import type { PrismaClient, Prisma, ContactChannelType } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { normalizeChannelValue } from '@/lib/services/contacts/resolveContactByChannel';
import { recordAudit } from '@/lib/auth/audit';

export type ContactChannelInput = { type: ContactChannelType; value: string };
export type CreateContactArgs = {
  name: string;
  organizationId?: string | null;
  position?: string;
  note?: string;
  channels: ContactChannelInput[];
};
export type CreateContactResult = { ok: true; contactId: string } | { ok: false; error: 'forbidden' | 'invalid' };

export async function createContact(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateContactArgs
): Promise<CreateContactResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const name = args.name.trim();
  if (!name) return { ok: false, error: 'invalid' };

  const channelData: Prisma.ContactChannelCreateWithoutContactInput[] = args.channels
    .map((ch, i) => ({
      companyId: session.companyId!, type: ch.type, value: ch.value.trim(),
      normalizedValue: normalizeChannelValue(ch.type, ch.value), isPrimary: i === 0,
    }))
    .filter((ch) => ch.normalizedValue !== '');

  const contact = await prisma.contact.create({
    data: {
      companyId: session.companyId,
      organizationId: args.organizationId ?? null,
      name, position: args.position?.trim() || null, note: args.note?.trim() || null,
      createdById: session.sub,
      channels: { create: channelData },
    },
    select: { id: true },
  });

  await recordAudit(prisma, {
    action: 'contact_created',
    entity: 'contact',
    entityId: contact.id,
    userId: session.sub,
    after: { organizationId: args.organizationId ?? null },
  });
  return { ok: true, contactId: contact.id };
}

/**
 * Learn-on-link: attach a communication identifier to a contact if not already
 * present. Idempotent — a duplicate (company,type,normalizedValue) is a no-op.
 */
export async function captureChannel(
  prisma: PrismaClient,
  args: { contactId: string; companyId: string; type: ContactChannelType; value: string }
): Promise<void> {
  const normalizedValue = normalizeChannelValue(args.type, args.value);
  if (!normalizedValue) return;
  const exists = await prisma.contactChannel.findFirst({
    where: { companyId: args.companyId, type: args.type, normalizedValue }, select: { id: true },
  });
  if (exists) return;
  try {
    await prisma.contactChannel.create({
      data: { contactId: args.contactId, companyId: args.companyId, type: args.type, value: args.value.trim(), normalizedValue },
    });
  } catch (e) {
    if (!(e instanceof Error && e.message.includes('Unique'))) throw e;
  }
}
