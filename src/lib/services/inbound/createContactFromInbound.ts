import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { createContact } from '@/lib/services/manager/contacts';
import { bindInboundMessage, CHANNEL_TO_CONTACT_TYPE } from '@/lib/services/inbound/bind';

export type CreateContactFromInboundArgs = {
  inboundMessageId: string;
  organizationId: string;
  name: string;
};

export type CreateContactFromInboundResult =
  { ok: true; contactId: string } | { ok: false; error: 'forbidden' | 'invalid' | 'not_found' };

/**
 * Creates a new contact from an inbound message's sender identity, then binds
 * the message to it. Mirrors the call-side flow in
 * `createContactFromCallAction` (src/server-actions/contacts.ts) — same job,
 * different source entity (InboundMessage vs Call). `createContact` writes the
 * sender identity (`senderRef`) as the contact's primary channel, so
 * `bindInboundMessage`'s learn-on-link capture is a no-op for it — it's already
 * there.
 *
 * A bind failure is surfaced (e.g. `'not_found'` if the message vanished): the
 * created contact is itself valid and org-scoped, so no rollback is needed, but
 * the caller must know the MESSAGE wasn't attributed.
 */
export async function createContactFromInbound(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateContactFromInboundArgs
): Promise<CreateContactFromInboundResult> {
  const message = await prisma.inboundMessage.findUnique({
    where: { id: args.inboundMessageId },
    select: { channel: true, senderRef: true },
  });
  if (!message) return { ok: false, error: 'not_found' };

  const channelType =
    CHANNEL_TO_CONTACT_TYPE[message.channel as keyof typeof CHANNEL_TO_CONTACT_TYPE];
  const created = await createContact(prisma, session, {
    name: args.name,
    organizationId: args.organizationId,
    channels: [{ type: channelType, value: message.senderRef }],
  });
  if (!created.ok) return created;

  const bound = await bindInboundMessage(prisma, session, {
    inboundMessageId: args.inboundMessageId,
    organizationId: args.organizationId,
    contactId: created.contactId,
  });
  if (!bound.ok) return { ok: false, error: bound.error };
  return created;
}
