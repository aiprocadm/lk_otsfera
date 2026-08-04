import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { isInboundMessageInScope } from '@/lib/services/inbound/scope';

/**
 * `changed` tells the caller whether the row actually moved: the idempotent
 * re-archive is a successful no-op and must NOT revalidate the inbox page
 * (nothing changed) — that decision belongs to the server-action, so the
 * service reports the fact instead of hiding it.
 */
export type ArchiveInboundMessageResult =
  { ok: true; changed: boolean } | { ok: false; error: 'forbidden' | 'not_found' };

export type RestoreInboundMessageResult =
  { ok: true } | { ok: false; error: 'forbidden' | 'not_found' };

/**
 * Archives an inbound message (E2). Scope: the shared C8 predicate
 * `isInboundMessageInScope` (scope.ts) — own company's messages plus the
 * shared unresolved triage queue; a foreign company's bound message is
 * `forbidden`. Archiving an unresolved (companyId=null) message PINS it to
 * the archiver's company (bind-like semantics: a staff action fixes the
 * message to the actor's company) — otherwise the archived row would leave
 * EVERY session's scope forever (the scope matches own-company rows OR
 * status='unresolved', and archiving drops the status branch), i.e. it would
 * be invisible in the list and unrestorable. Pinning requires the actor to
 * HAVE a company, so a companyId-less session gets `forbidden` on the shared
 * queue. An unresolved row that ALREADY carries a companyId (restored after a
 * pin) is NOT re-pinned: company B archiving a row pinned to A sends it to
 * A's archive — deterministic and restorable by A. Idempotent: archiving an
 * already-archived message is a no-op `{ ok: true, changed: false }` (no
 * update, no audit). The write is a compare-and-swap on the status we read
 * (`updateMany` with `status` in the where): a concurrent bind/archive that
 * moved the row between our read and write yields 0 rows → `not_found`
 * (TOCTOU guard — otherwise archive(co-B) racing bind(co-A) on one unresolved
 * row could stamp co-B's pin over the fresh co-A binding, crossing C8).
 */
export async function archiveInboundMessage(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { inboundMessageId: string }
): Promise<ArchiveInboundMessageResult> {
  const message = await prisma.inboundMessage.findUnique({
    where: { id: args.inboundMessageId },
    select: { companyId: true, status: true },
  });
  if (!message) return { ok: false, error: 'not_found' };

  if (!isInboundMessageInScope(session, message)) return { ok: false, error: 'forbidden' };

  if (message.status === 'archived') return { ok: true, changed: false };

  // Unresolved queue → pin to the archiver's company (see JSDoc); an
  // already-bound message keeps its companyId untouched.
  let data: { status: string; companyId?: string };
  if (message.companyId == null) {
    if (!session.companyId) return { ok: false, error: 'forbidden' };
    data = { status: 'archived', companyId: session.companyId };
  } else {
    data = { status: 'archived' };
  }

  // CAS on the status we based the decision on (see JSDoc: TOCTOU guard).
  const updated = await prisma.inboundMessage.updateMany({
    where: { id: args.inboundMessageId, status: message.status },
    data,
  });
  if (updated.count === 0) return { ok: false, error: 'not_found' };

  await recordAudit(prisma, {
    action: 'inbound_message_archived',
    entity: 'order_thread',
    entityId: args.inboundMessageId,
    userId: session.sub,
    before: { status: message.status },
    after: data,
  });

  return { ok: true, changed: true };
}

/**
 * Restores an archived inbound message (E2) back to its pre-archive status:
 * `bound` if it was ever bound (`boundAt` set), otherwise `unresolved`.
 * Scope: same shared C8 predicate as archive. A non-archived message returns
 * `not_found` — there is nothing to restore (semantics agreed in the plan).
 * A message restored to `unresolved` keeps the companyId pinned by archive —
 * shared-queue visibility comes from the status branch of the scope, and a
 * later bind overwrites companyId from the target organization anyway.
 * The write is a compare-and-swap on `status='archived'` (`updateMany`):
 * a concurrent restore/bind that moved the row between our read and write
 * yields 0 rows → `not_found` (TOCTOU guard, same as archive).
 */
export async function restoreInboundMessage(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { inboundMessageId: string }
): Promise<RestoreInboundMessageResult> {
  const message = await prisma.inboundMessage.findUnique({
    where: { id: args.inboundMessageId },
    select: { companyId: true, status: true, boundAt: true },
  });
  if (!message) return { ok: false, error: 'not_found' };

  if (!isInboundMessageInScope(session, message)) return { ok: false, error: 'forbidden' };

  if (message.status !== 'archived') return { ok: false, error: 'not_found' };

  const restoredStatus = message.boundAt ? 'bound' : 'unresolved';
  // CAS on 'archived' (see JSDoc: TOCTOU guard).
  const updated = await prisma.inboundMessage.updateMany({
    where: { id: args.inboundMessageId, status: 'archived' },
    data: { status: restoredStatus },
  });
  if (updated.count === 0) return { ok: false, error: 'not_found' };

  await recordAudit(prisma, {
    action: 'inbound_message_restored',
    entity: 'order_thread',
    entityId: args.inboundMessageId,
    userId: session.sub,
    before: { status: 'archived' },
    after: { status: restoredStatus },
  });

  return { ok: true };
}
