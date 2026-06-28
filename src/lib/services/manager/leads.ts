import type { PrismaClient, LeadStatus, Prisma } from '@prisma/client';

/**
 * Manager-side lead reads (T3). Leads are a shared TEAM QUEUE (owner decision):
 * every manager sees every lead — they are inbound to the company's manager team,
 * not org-scoped like orders. RBAC is `requireManager` at the route; there is no
 * per-manager visibility filter here by design (cross-company isolation does not
 * apply: leads have no companyId and the cabinet is a single company-tenant).
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
  partnerName: string;
  assignedManagerId: string | null;
  assignedManagerName: string | null;
  promotedOrderId: string | null;
  createdAt: Date;
};

export type ListManagerLeadsOptions = {
  status?: LeadStatus;
  search?: string;
  assignedToUserId?: string; // filter to leads assigned to this manager ("мои")
  cursor?: string;
  take?: number;
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
  const where: Prisma.LeadWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.assignedToUserId ? { assignedManagerId: opts.assignedToUserId } : {}),
    ...(opts.search
      ? {
          OR: [
            { clientCompanyName: { contains: opts.search, mode: 'insensitive' } },
            { subject: { contains: opts.search, mode: 'insensitive' } },
            { clientInn: { contains: opts.search } }
          ]
        }
      : {})
  };

  const rows = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      organization: { select: { id: true, name: true } },
      partner: { select: { name: true } },
      assignedManager: { select: { name: true } }
    }
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
      partnerName: l.partner.name,
      assignedManagerId: l.assignedManagerId,
      assignedManagerName: l.assignedManager?.name ?? null,
      promotedOrderId: l.promotedOrderId,
      createdAt: l.createdAt
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null
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
};

export async function getManagerLead(
  prisma: PrismaClient,
  leadId: string
): Promise<ManagerLeadDetail | null> {
  const l = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      organization: { select: { id: true, name: true } },
      partner: { select: { name: true } },
      assignedManager: { select: { name: true } },
      createdByUser: { select: { name: true } }
    }
  });
  if (!l) return null;
  return {
    id: l.id,
    clientCompanyName: l.clientCompanyName,
    clientInn: l.clientInn,
    subject: l.subject,
    status: l.status,
    estimatedAmount: l.estimatedAmount ? l.estimatedAmount.toFixed(2) : null,
    organizationId: l.organization?.id ?? null,
    organizationName: l.organization?.name ?? null,
    partnerName: l.partner.name,
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
    updatedAt: l.updatedAt
  };
}
