import type { ClientRequestStatus, Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import { canTriageClientRequests } from './policy';

/**
 * DTO обращения — общий для клиента и staff, поэтому НЕ содержит связей с
 * внутренним контуром. Этап 10 (§7 ТЗ): поле `convertedLeadId` удалено —
 * «связь заявки с лидом/сделкой» клиенту видеть нельзя (он видит только статус
 * и, для принятых, созданный заказ). В UI поле не использовалось.
 */
export type ClientRequestRow = {
  id: string;
  source: 'partner_cabinet' | 'organization_cabinet' | 'website';
  companyName: string;
  inn: string | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  subject: string;
  body: string | null;
  status: ClientRequestStatus;
  submittedByName: string;
  partnerName: string | null;
  organizationName: string | null;
  organizationId: string | null;
  rejectedReason: string | null;
  createdAt: Date;
  triagedAt: Date | null;
  attachmentCount: number;
};

const ROW_INCLUDE = {
  submittedByUser: { select: { name: true } },
  partner: { select: { name: true } },
  organization: { select: { name: true } },
  _count: { select: { attachments: true } },
} satisfies Prisma.ClientRequestInclude;

type RowSource = Prisma.ClientRequestGetPayload<{ include: typeof ROW_INCLUDE }>;

function toRow(r: RowSource): ClientRequestRow {
  return {
    id: r.id,
    source: r.source,
    companyName: r.companyName,
    inn: r.inn,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    subject: r.subject,
    body: r.body,
    status: r.status,
    submittedByName: r.submittedByUser.name,
    partnerName: r.partner?.name ?? null,
    organizationName: r.organization?.name ?? null,
    organizationId: r.organizationId,
    rejectedReason: r.rejectedReason,
    createdAt: r.createdAt,
    triagedAt: r.triagedAt,
    attachmentCount: r._count.attachments,
  };
}

/**
 * Скоуп видимости (этап 5, §4 спеки): податель видит только свои; staff —
 * очередь по C8-паттерну inbox: заявки организаций своей компании + «общая
 * очередь» (organizationId=null — партнёрские заявки без организации; у
 * Partner нет companyId, поэтому они видимы всем менеджерам). Admin — всё.
 * companyId=null у менеджера → только общая очередь (deny по компаниям).
 */
export function clientRequestScopeWhere(session: SessionPayload): Prisma.ClientRequestWhereInput {
  if (session.role === 'admin') return {};
  if (canTriageClientRequests(session)) {
    return {
      OR: [
        { organization: { companyId: session.companyId ?? '__none__' } },
        { organizationId: null },
      ],
    };
  }
  return { submittedByUserId: session.sub };
}

export type ListClientRequestsOptions = {
  status?: ClientRequestStatus;
  take?: number;
  cursor?: string;
};

export async function listClientRequests(
  prisma: PrismaClient,
  session: SessionPayload,
  opts: ListClientRequestsOptions = {}
): Promise<{ rows: ClientRequestRow[]; nextCursor: string | null }> {
  const take = opts.take ?? 20;
  const rows = await prisma.clientRequest.findMany({
    where: {
      AND: [clientRequestScopeWhere(session), ...(opts.status ? [{ status: opts.status }] : [])],
    },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: ROW_INCLUDE,
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  await recordPiiAccess(prisma, {
    session,
    context: 'client_requests_list',
    subjectIds: page.map((r) => r.id),
    meta: { take, cursor: opts.cursor !== undefined },
  });

  return { rows: page.map(toRow), nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

/** Деталка: скоуп как у списка — чужая заявка неотличима от несуществующей. */
export async function getClientRequest(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true; request: ClientRequestRow } | { ok: false; error: 'not_found' }> {
  const r = await prisma.clientRequest.findFirst({
    where: { AND: [{ id }, clientRequestScopeWhere(session)] },
    include: ROW_INCLUDE,
  });
  if (!r) return { ok: false, error: 'not_found' };

  await recordPiiAccess(prisma, {
    session,
    context: 'client_request_view',
    subjectIds: [r.id],
  });

  return { ok: true, request: toRow(r) };
}
