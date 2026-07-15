import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { captureChannel } from '@/lib/services/manager/contacts';
import { recordAudit } from '@/lib/auth/audit';

export type BindCallArgs = { callId: string; organizationId: string; contactId?: string; orderId?: string };
export type BindCallResult = { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

/**
 * Binds an unresolved (or mis-resolved) Call to a specific organization
 * (and optionally a contact/order), so a manager can triage an inbound/outbound
 * call that automatic caller-number resolution failed to match.
 *
 * Scope is company-wide, NOT per-manager (`managedOrgIds`) — this deliberately
 * differs from `bindInboundMessageAction` (src/server-actions/inbound.ts),
 * which additionally gates scoped-mode binding via `isOrgInScope`. Calls are a
 * shared team queue: `listCalls` (src/lib/services/telephony/listCalls.ts,
 * Task 6) already scopes the call list company-wide (`companyId` match, plus
 * the shared unresolved `companyId=null` bucket) regardless of
 * `managerTeamVisibility` — any manager who can SEE an unresolved call in
 * their company's queue must also be able to triage-bind it. The only hard
 * boundary is C8 (CLAUDE.md §4): the target organization must belong to the
 * manager's own company.
 *
 * Learn-on-link: when a contact is bound, the call's caller number is captured
 * as a phone channel on that contact (`captureChannel`, idempotent) so future
 * calls from the same number auto-resolve.
 */
export async function bindCall(
  prisma: PrismaClient,
  session: SessionPayload,
  args: BindCallArgs
): Promise<BindCallResult> {
  const call = await prisma.call.findUnique({
    where: { id: args.callId },
    select: { id: true, callerNumber: true }
  });
  if (!call) return { ok: false, error: 'not_found' };

  const org = await prisma.organization.findUnique({
    where: { id: args.organizationId },
    select: { id: true, companyId: true }
  });
  if (!org) return { ok: false, error: 'not_found' };

  // C8: company is the hard (and only) isolation boundary for call triage —
  // no per-manager `isOrgInScope` narrowing (see doc comment above).
  if (!session.companyId || org.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }

  let contactId: string | null = null;
  if (args.contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: args.contactId },
      select: { id: true, companyId: true, organizationId: true }
    });
    if (!contact || contact.companyId !== session.companyId) return { ok: false, error: 'forbidden' };
    if (contact.organizationId && contact.organizationId !== args.organizationId) {
      return { ok: false, error: 'forbidden' };
    }
    contactId = contact.id;
  }

  // Best-effort thread resolution: only if an orderId was given AND that order
  // belongs to the target org AND to the manager's own company.
  let threadId: string | null = null;
  if (args.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: { id: true, organizationId: true, companyId: true }
    });
    const orderInScope =
      !!order &&
      order.organizationId === args.organizationId &&
      order.companyId === session.companyId;
    if (orderInScope) {
      const thread = await prisma.orderThread.findUnique({
        where: { orderId_side: { orderId: args.orderId, side: 'org' } },
        select: { id: true }
      });
      threadId = thread?.id ?? null;
    }
  }

  await prisma.call.update({
    where: { id: args.callId },
    data: { resolvedOrgId: args.organizationId, companyId: org.companyId, contactId, threadId }
  });

  if (contactId && call.callerNumber) {
    await captureChannel(prisma, {
      contactId,
      companyId: org.companyId,
      type: 'phone',
      value: call.callerNumber
    });
  }

  await recordAudit(prisma, {
    action: 'call_bound',
    entity: 'call',
    entityId: args.callId,
    userId: session.sub,
    after: { organizationId: args.organizationId, contactId, threadId }
  });

  return { ok: true };
}
