import type { PrismaClient, ContactChannelType } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getCompanyTeamVisibility, isOrgInScope, isManagerLeader } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { captureChannel } from '@/lib/services/manager/contacts';
import { isInboundMessageInScope } from '@/lib/services/inbound/scope';

/**
 * `InboundMessage.channel` values map 1:1 onto `ContactChannelType` — used by
 * the learn-on-link capture in `bindInboundMessage` below, and reused by
 * `createContactFromInbound` (createContactFromInbound.ts) to seed the new
 * contact's channel from the message that created it.
 */
export const CHANNEL_TO_CONTACT_TYPE: Record<
  'telegram' | 'max' | 'whatsapp' | 'email',
  ContactChannelType
> = {
  telegram: 'telegram',
  max: 'max',
  whatsapp: 'whatsapp',
  email: 'email',
};

export type BindInboundMessageArgs = {
  inboundMessageId: string;
  organizationId: string;
  orderId?: string;
  contactId?: string;
};

export type BindInboundMessageResult =
  { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

/**
 * Binds an unresolved/mis-resolved InboundMessage to a specific organization
 * (and optionally an order and/or a contact), so a manager can triage inbound
 * chat/email that `resolveInboundSender` (resolve.ts) failed to auto-match.
 * Company-scoped (CLAUDE.md §4, C8): the target organization must belong to the
 * manager's own company — team-visibility-aware via `getCompanyTeamVisibility`
 * (ON → any org in the company; OFF → only orgs in `session.managedOrgIds` via
 * `isOrgInScope`). The MESSAGE itself must also be in the C8 inbox scope
 * (`isInboundMessageInScope`, scope.ts): without that gate a manager of company
 * B could re-bind company A's bound/archived row by cuid, stealing it into their
 * own company (E2 hardening).
 *
 * Learn-on-link: when a contact is bound, the message's sender identity
 * (`senderRef`) is captured as a channel on that contact (`captureChannel`,
 * idempotent) so future messages from the same sender auto-resolve. Mirrors
 * `bindCall` (src/lib/services/telephony/bindCall.ts) — same shape, different
 * source entity.
 */
export async function bindInboundMessage(
  prisma: PrismaClient,
  session: SessionPayload,
  args: BindInboundMessageArgs
): Promise<BindInboundMessageResult> {
  const message = await prisma.inboundMessage.findUnique({
    where: { id: args.inboundMessageId },
    select: { id: true, channel: true, senderRef: true, companyId: true, status: true },
  });
  if (!message) return { ok: false, error: 'not_found' };

  // C8 scope gate (E2): own company's rows or the shared unresolved queue —
  // BEFORE the org lookup, so a foreign row costs no extra queries and does
  // not depend on whichever organizationId the caller supplied.
  if (!isInboundMessageInScope(session, message)) {
    return { ok: false, error: 'forbidden' };
  }

  const org = await prisma.organization.findUnique({
    where: { id: args.organizationId },
    select: { id: true, companyId: true },
  });
  if (!org) return { ok: false, error: 'not_found' };

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  // C8: company is the hard isolation boundary — enforce in BOTH modes.
  // (managedOrgIds is loaded without a company filter, so in teamMode OFF a
  // cross-company OrganizationManager assignment would otherwise let a manager
  // bind an inbound to a foreign company's org, writing that foreign companyId
  // — an IDOR hole. CLAUDE.md §4/§5.)
  if (!session.companyId || org.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }
  // managedOrgIds only further narrows within teamMode OFF (company already
  // enforced above).
  // Руководителя сужение по закреплению не касается (лидер-инвариант C8):
  // компания проверена выше.
  if (!teamMode && !isManagerLeader(session) && !isOrgInScope(session, args.organizationId)) {
    return { ok: false, error: 'forbidden' };
  }

  // Optional contact attribution: the contact must belong to the manager's own
  // company and (if it already has an org) that org must match the target —
  // mirrors bindCall's contact gate (src/lib/services/telephony/bindCall.ts).
  let contactId: string | null = null;
  if (args.contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: args.contactId },
      select: { id: true, companyId: true, organizationId: true },
    });
    if (!contact || contact.companyId !== session.companyId)
      return { ok: false, error: 'forbidden' };
    if (contact.organizationId && contact.organizationId !== args.organizationId) {
      return { ok: false, error: 'forbidden' };
    }
    contactId = contact.id;
  }

  // Best-effort thread resolution: only if an orderId was given AND that
  // order belongs to the target org AND is itself in the manager's scope.
  let threadId: string | null = null;
  if (args.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: { id: true, organizationId: true, companyId: true },
    });
    const orderInScope =
      !!order &&
      order.organizationId === args.organizationId &&
      // C8-гейт выше уже гарантирует session.companyId non-null.
      (teamMode ? order.companyId === session.companyId : true);
    if (orderInScope) {
      const thread = await prisma.orderThread.findUnique({
        where: { orderId_side: { orderId: args.orderId, side: 'org' } },
        select: { id: true },
      });
      threadId = thread?.id ?? null;
    }
  }

  await prisma.inboundMessage.update({
    where: { id: args.inboundMessageId },
    data: {
      resolvedOrgId: args.organizationId,
      companyId: org.companyId,
      threadId,
      contactId,
      status: 'bound',
      boundAt: new Date(),
      boundById: session.sub,
    },
  });

  if (contactId) {
    const channelType =
      CHANNEL_TO_CONTACT_TYPE[message.channel as keyof typeof CHANNEL_TO_CONTACT_TYPE];
    await captureChannel(prisma, {
      contactId,
      companyId: org.companyId,
      type: channelType,
      value: message.senderRef,
    });
  }

  await recordAudit(prisma, {
    action: 'inbound_message_bound',
    entity: 'order_thread',
    entityId: args.inboundMessageId,
    userId: session.sub,
    after: { organizationId: args.organizationId, threadId, contactId },
  });

  return { ok: true };
}
