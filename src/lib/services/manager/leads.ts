import type { PrismaClient, LeadStatus, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { leadWhereForLevel } from '@/lib/auth/accessProfile';
import { recordPiiAccess } from '@/lib/pii/record';

/**
 * Manager-side lead reads (T3). Leads are a shared TEAM QUEUE by default (owner
 * decision): inbound to the company's manager team, not org-scoped like orders.
 * Cross-company isolation does not apply — leads have no companyId, single-tenant.
 *
 * G2 (наслоение): при наличии профиля доступа (`session.accessProfile`)
 * применяется leads-охват (own/assigned/all) через `leadWhereForLevel`; без
 * профиля — legacy team-wide (без фильтра), поведение байт-в-байт.
 */

export type ManagerLeadRow = {
  id: string;
  clientCompanyName: string;
  clientInn: string | null;
  subject: string;
  status: LeadStatus;
  estimatedAmount: string | null;
  organizationId: string | null;
  organizationName: string | null;
  // Этап 5: лид из заявки организации / ручной может быть без партнёра.
  partnerName: string | null;
  assignedManagerId: string | null;
  assignedManagerName: string | null;
  promotedOrderId: string | null;
  createdAt: Date;
};

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type ListManagerLeadsOptions = {
  session?: SessionPayload | undefined; // G2: источник leads-охвата (профиль). Без него — legacy.
  status?: LeadStatus | undefined;
  search?: string | undefined;
  assignedToUserId?: string | undefined; // filter to leads assigned to this manager ("мои")
  cursor?: string | undefined;
  take?: number | undefined;
};

export type ListManagerLeadsResult = {
  rows: ManagerLeadRow[];
  nextCursor: string | null;
};

export async function listManagerLeads(
  prisma: PrismaClient,
  opts: ListManagerLeadsOptions
): Promise<ListManagerLeadsResult> {
  const take = opts.take ?? 20;
  // AND-компоновка: scope-OR (assigned) и search-OR не должны затирать друг друга.
  const filters: Prisma.LeadWhereInput[] = [];
  if (opts.session?.accessProfile) {
    filters.push(leadWhereForLevel(opts.session, opts.session.accessProfile.leads));
  }
  if (opts.status) filters.push({ status: opts.status });
  if (opts.assignedToUserId) filters.push({ assignedManagerId: opts.assignedToUserId });
  if (opts.search) {
    filters.push({
      OR: [
        { clientCompanyName: { contains: opts.search, mode: 'insensitive' } },
        { subject: { contains: opts.search, mode: 'insensitive' } },
        { clientInn: { contains: opts.search } },
      ],
    });
  }
  const where: Prisma.LeadWhereInput = filters.length ? { AND: filters } : {};

  const rows = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      organization: { select: { id: true, name: true } },
      partner: { select: { name: true } },
      assignedManager: { select: { name: true } },
    },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    rows: page.map((l) => ({
      id: l.id,
      clientCompanyName: l.clientCompanyName,
      clientInn: l.clientInn,
      subject: l.subject,
      status: l.status,
      estimatedAmount: l.estimatedAmount ? l.estimatedAmount.toFixed(2) : null,
      organizationId: l.organization?.id ?? null,
      organizationName: l.organization?.name ?? null,
      partnerName: l.partner?.name ?? null,
      assignedManagerId: l.assignedManagerId,
      assignedManagerName: l.assignedManager?.name ?? null,
      promotedOrderId: l.promotedOrderId,
      createdAt: l.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export type ManagerLeadDetail = ManagerLeadRow & {
  clientContactName: string;
  clientContactPhone: string | null;
  clientContactEmail: string | null;
  productType: string[];
  notes: string | null;
  rejectedReason: string | null;
  createdByUserName: string;
  updatedAt: Date;
  // B3: состояние ручной отправки в 1С (строка «1С» + гейт кнопки на странице лида)
  externalIdInOneC: string | null;
  pushedToOneCAt: Date | null;
  // Этап 7 (ФТ-3.1): происхождение лида + id источника для ссылки.
  source: string;
  sourceRequestId: string | null;
  sourceCallId: string | null;
  sourceInboundId: string | null;
};

export async function getManagerLead(
  prisma: PrismaClient,
  session: SessionPayload,
  leadId: string
): Promise<ManagerLeadDetail | null> {
  const l = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      organization: { select: { id: true, name: true } },
      partner: { select: { name: true } },
      assignedManager: { select: { name: true } },
      createdByUser: { select: { name: true } },
    },
  });
  if (!l) return null;
  await recordPiiAccess(prisma, {
    session,
    context: 'manager_lead_view',
    subjectIds: [l.id],
  });
  return {
    id: l.id,
    clientCompanyName: l.clientCompanyName,
    clientInn: l.clientInn,
    subject: l.subject,
    status: l.status,
    estimatedAmount: l.estimatedAmount ? l.estimatedAmount.toFixed(2) : null,
    organizationId: l.organization?.id ?? null,
    organizationName: l.organization?.name ?? null,
    partnerName: l.partner?.name ?? null,
    assignedManagerId: l.assignedManagerId,
    assignedManagerName: l.assignedManager?.name ?? null,
    promotedOrderId: l.promotedOrderId,
    createdAt: l.createdAt,
    clientContactName: l.clientContactName,
    clientContactPhone: l.clientContactPhone,
    clientContactEmail: l.clientContactEmail,
    productType: l.productType,
    notes: l.notes,
    rejectedReason: l.rejectedReason,
    createdByUserName: l.createdByUser.name,
    updatedAt: l.updatedAt,
    externalIdInOneC: l.externalIdInOneC,
    pushedToOneCAt: l.pushedToOneCAt,
    source: l.source,
    sourceRequestId: l.sourceRequestId,
    sourceCallId: l.sourceCallId,
    sourceInboundId: l.sourceInboundId,
  };
}
