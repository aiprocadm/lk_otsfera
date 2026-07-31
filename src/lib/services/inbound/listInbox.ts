import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import { inboxScopeWhere } from '@/lib/services/inbound/scope';

/**
 * Company-scoped staff inbox query (Task 11a).
 *
 * C8 invariant: a manager sees their OWN company's bound inbound messages
 * PLUS the shared "unresolved" triage queue (companyId=null — not yet bound
 * to any company), and NEVER another company's bound messages. The scope
 * itself lives in `scope.ts` (`inboxScopeWhere`, E2) — the single source of
 * truth shared with the attachment route and archive/restore actions.
 */

export type InboxFilters = {
  channel?: string;
  status?: 'unresolved' | 'bound' | 'archived';
  orgId?: string;
  page?: number;
  pageSize?: number;
};

export type InboxItem = {
  id: string;
  channel: string;
  senderRef: string;
  senderDisplay: string | null;
  subject: string | null;
  body: string;
  createdAt: Date;
  status: string;
  resolvedOrgId: string | null;
  scanStatus: string;
  attachmentName: string | null;
};

export type InboxResult = { items: InboxItem[]; total: number };

const INBOX_SELECT = {
  id: true,
  channel: true,
  senderRef: true,
  senderDisplay: true,
  subject: true,
  body: true,
  createdAt: true,
  status: true,
  resolvedOrgId: true,
  scanStatus: true,
  attachmentName: true,
} satisfies Prisma.InboundMessageSelect;

export async function listInbox(
  prisma: PrismaClient,
  session: SessionPayload,
  filters: InboxFilters = {}
): Promise<InboxResult> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  // C8: bound messages are visible ONLY within the manager's own company;
  // unresolved messages (companyId null) are the shared triage queue,
  // visible to all staff. See scope.ts for the sentinel rationale.
  const scope = inboxScopeWhere(session);

  const extra: Prisma.InboundMessageWhereInput = {};
  if (filters.channel) extra.channel = filters.channel;
  if (filters.status) extra.status = filters.status;
  if (filters.orgId) extra.resolvedOrgId = filters.orgId;

  const where: Prisma.InboundMessageWhereInput = { AND: [scope, extra] };

  const [rows, total] = await Promise.all([
    prisma.inboundMessage.findMany({
      where,
      select: INBOX_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.inboundMessage.count({ where }),
  ]);

  await recordPiiAccess(prisma, {
    session,
    context: 'inbox_list',
    subjectIds: rows.map((r) => r.id),
  });

  return { items: rows, total };
}
