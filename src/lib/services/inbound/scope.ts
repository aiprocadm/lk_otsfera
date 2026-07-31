import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * C8 inbox scope — the single source of truth for "which inbound messages a
 * staff session may see/touch" (Task E2; extracted from `listInbox.ts` per the
 * E1 review).
 *
 * A manager sees their OWN company's bound/archived messages PLUS the shared
 * "unresolved" triage queue (companyId=null — not yet bound to any company),
 * and NEVER another company's messages. The `'__no_company__'` sentinel keeps
 * a companyId-less session from matching every company's rows on the company
 * branch (`companyId: undefined` would strip the filter and leak) — the
 * proven pattern of `chat/threads.ts` `scopeWhere`.
 *
 * IMPORTANT: `inboxScopeWhere` (Prisma where) and `isInboundMessageInScope`
 * (in-memory predicate) MUST stay semantically identical — change them
 * synchronously. The equivalence matrix in
 * `src/__tests__/services.inbound.scope.unit.test.ts` enforces this.
 */

const NO_COMPANY_SENTINEL = '__no_company__';

/** Prisma-where form of the C8 inbox scope (list/count queries). */
export function inboxScopeWhere(session: SessionPayload): Prisma.InboundMessageWhereInput {
  return {
    OR: [{ companyId: session.companyId ?? NO_COMPANY_SENTINEL }, { status: 'unresolved' }],
  };
}

/**
 * In-memory form of the C8 inbox scope for a single already-loaded message
 * (attachment route, archive/restore actions). The `!= null` guard keeps a
 * companyId-less session from matching a null===null pair on the company
 * branch — the in-memory twin of the sentinel above.
 */
export function isInboundMessageInScope(
  session: SessionPayload,
  msg: { companyId: string | null; status: string }
): boolean {
  return (
    (msg.companyId != null && msg.companyId === session.companyId) || msg.status === 'unresolved'
  );
}
