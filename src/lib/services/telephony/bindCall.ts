import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getCompanyTeamVisibility, isOrgInScope, isManagerLeader } from '@/lib/auth/managerPolicy';
import { captureChannel } from '@/lib/services/manager/contacts';
import { recordAudit } from '@/lib/auth/audit';

export type BindCallArgs = { callId: string; organizationId: string; contactId?: string; orderId?: string };
export type BindCallResult = { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

/**
 * Binds an unresolved (or mis-resolved) Call to a specific organization
 * (and optionally a contact/order), so a manager can triage an inbound/outbound
 * call that automatic caller-number resolution failed to match.
 *
 * Scoping mirrors `bindInboundMessageAction` (src/server-actions/inbound.ts) —
 * visibility and bind-authority are deliberately separate. The unresolved call
 * queue is broadly VISIBLE company-wide (`listCalls` scopes the list by
 * `companyId` plus the shared `companyId=null` bucket), but BIND-AUTHORITY is
 * narrower: two gates, mirroring the inbound precedent (CLAUDE.md §4, C8):
 *   1. C8 company boundary (BOTH modes): the target organization must belong to
 *      the manager's own company.
 *   2. Per-manager `isOrgInScope` (teamMode OFF only): the manager must be
 *      assigned to that org via `managedOrgIds`. With `managerTeamVisibility`
 *      ON, any manager in the company may bind to any of its orgs.
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

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  // Bind-authority gates (see doc comment). C8 company boundary in BOTH modes;
  // per-manager isOrgInScope narrows further only when teamMode is OFF.
  if (!session.companyId || org.companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }
  // Руководителя сужение по закреплению не касается (лидер-инвариант C8):
  // компания проверена выше.
  if (!teamMode && !isManagerLeader(session) && !isOrgInScope(session, args.organizationId)) {
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
  // belongs to the target org AND is itself in the manager's scope.
  let threadId: string | null = null;
  if (args.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: args.orderId },
      select: { id: true, organizationId: true, companyId: true }
    });
    const orderInScope =
      !!order &&
      order.organizationId === args.organizationId &&
      (teamMode ? order.companyId === session.companyId : true);
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
