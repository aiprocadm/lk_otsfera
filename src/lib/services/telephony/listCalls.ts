import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';

/**
 * Company-scoped calls journal query (Task 9a).
 *
 * C8 invariant: a manager sees their OWN company's calls PLUS the shared
 * "unresolved" bucket (companyId=null — caller not yet bound to any company),
 * and NEVER another company's calls. Mirrors the proven sentinel pattern in
 * `inbound/listInbox.ts` — a companyId-less session must deny-all on the
 * company branch, not match every row (`companyId: undefined` would strip
 * the filter and leak cross-company).
 */

export type CallsFilters = {
  direction?: string;
  orgId?: string;
  page?: number;
  pageSize?: number;
};

type CallItem = {
  id: string;
  direction: string;
  callerNumber: string;
  internalNumber: string | null;
  status: string;
  durationSec: number | null;
  startedAt: Date | null;
  createdAt: Date;
  resolvedOrgId: string | null;
  recordingScanStatus: string;
  hasRecording: boolean;
};

export type CallsResult = { items: CallItem[]; total: number };

const CALL_SELECT = {
  id: true,
  direction: true,
  callerNumber: true,
  internalNumber: true,
  status: true,
  durationSec: true,
  startedAt: true,
  createdAt: true,
  resolvedOrgId: true,
  recordingScanStatus: true,
  recordingPath: true,
} satisfies Prisma.CallSelect;

export async function listCalls(
  prisma: PrismaClient,
  session: SessionPayload,
  filters: CallsFilters = {}
): Promise<CallsResult> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  // C8: a manager's own company's calls, plus the shared unresolved bucket
  // (companyId null). Sentinel guards a companyId-less session from matching
  // every company's bound rows.
  const scope: Prisma.CallWhereInput = {
    OR: [{ companyId: session.companyId ?? '__no_company__' }, { companyId: null }],
  };

  const extra: Prisma.CallWhereInput = {};
  if (filters.direction) extra.direction = filters.direction;
  if (filters.orgId) extra.resolvedOrgId = filters.orgId;

  const where: Prisma.CallWhereInput = { AND: [scope, extra] };

  const [rows, total] = await Promise.all([
    prisma.call.findMany({
      where,
      select: CALL_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.call.count({ where }),
  ]);

  const items: CallItem[] = rows.map(({ recordingPath, ...rest }) => ({
    ...rest,
    hasRecording: recordingPath != null,
  }));

  await recordPiiAccess(prisma, {
    session,
    context: 'calls_list',
    subjectIds: items.map((i) => i.id),
  });

  return { items, total };
}
