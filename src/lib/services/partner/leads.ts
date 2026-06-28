import type { PrismaClient, Lead, LeadStatus } from '@prisma/client';

export type LeadRow = {
  id: string;
  clientCompanyName: string;
  clientInn: string | null;
  clientContactName: string;
  subject: string;
  status: LeadStatus;
  estimatedAmount: string | null;
  productType: string[];
  organizationId: string | null;
  organizationName: string | null;
  promotedOrderId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadDetail = LeadRow & {
  clientContactPhone: string | null;
  clientContactEmail: string | null;
  notes: string | null;
  rejectedReason: string | null;
  createdByUserName: string;
  assignedManagerName: string | null;
};

export type ListLeadsFilter = {
  partnerId: string;
  scopeOrgIds?: string[];
  status?: LeadStatus;
  search?: string;
  take: number;
  skip: number;
};

export type ListLeadsResult = {
  rows: LeadRow[];
  total: number;
  countsByStatus: Partial<Record<LeadStatus, number>>;
};

const ALL_STATUSES: LeadStatus[] = [
  'new',
  'in_review',
  'qualified',
  'promoted_to_order',
  'rejected'
];

export async function listLeads(
  prisma: PrismaClient,
  filter: ListLeadsFilter
): Promise<ListLeadsResult> {
  const orgScopeFilter = filter.scopeOrgIds && filter.scopeOrgIds.length > 0
    ? { organizationId: { in: filter.scopeOrgIds } }
    : {};

  const baseWhere = {
    partnerId: filter.partnerId,
    ...orgScopeFilter
  };

  const where = {
    ...baseWhere,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.search
      ? {
          OR: [
            { clientCompanyName: { contains: filter.search, mode: 'insensitive' as const } },
            { clientContactName: { contains: filter.search, mode: 'insensitive' as const } },
            { subject: { contains: filter.search, mode: 'insensitive' as const } },
            { clientInn: { contains: filter.search } }
          ]
        }
      : {})
  };

  const [rowsRaw, total, countsRaw] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: filter.take,
      skip: filter.skip,
      include: {
        organization: { select: { id: true, name: true } }
      }
    }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true }
    })
  ]);

  const countsByStatus: Partial<Record<LeadStatus, number>> = {};
  for (const c of countsRaw) {
    countsByStatus[c.status] = c._count._all;
  }
  for (const s of ALL_STATUSES) {
    if (countsByStatus[s] === undefined) countsByStatus[s] = 0;
  }

  const rows: LeadRow[] = rowsRaw.map((l) => ({
    id: l.id,
    clientCompanyName: l.clientCompanyName,
    clientInn: l.clientInn,
    clientContactName: l.clientContactName,
    subject: l.subject,
    status: l.status,
    estimatedAmount: l.estimatedAmount ? l.estimatedAmount.toFixed(2) : null,
    productType: l.productType,
    organizationId: l.organization?.id ?? null,
    organizationName: l.organization?.name ?? null,
    promotedOrderId: l.promotedOrderId,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt
  }));

  return { rows, total, countsByStatus };
}

export async function getLead(
  prisma: PrismaClient,
  args: { leadId: string; partnerId: string; scopeOrgIds?: string[] }
): Promise<LeadDetail | null> {
  const lead = await prisma.lead.findFirst({
    where: {
      id: args.leadId,
      partnerId: args.partnerId,
      ...(args.scopeOrgIds && args.scopeOrgIds.length > 0
        ? { OR: [{ organizationId: { in: args.scopeOrgIds } }, { organizationId: null }] }
        : {})
    },
    include: {
      organization: { select: { id: true, name: true } },
      createdByUser: { select: { name: true } },
      assignedManager: { select: { name: true } }
    }
  });

  if (!lead) return null;

  return {
    id: lead.id,
    clientCompanyName: lead.clientCompanyName,
    clientInn: lead.clientInn,
    clientContactName: lead.clientContactName,
    clientContactPhone: lead.clientContactPhone,
    clientContactEmail: lead.clientContactEmail,
    subject: lead.subject,
    status: lead.status,
    estimatedAmount: lead.estimatedAmount ? lead.estimatedAmount.toFixed(2) : null,
    productType: lead.productType,
    organizationId: lead.organization?.id ?? null,
    organizationName: lead.organization?.name ?? null,
    promotedOrderId: lead.promotedOrderId,
    notes: lead.notes,
    rejectedReason: lead.rejectedReason,
    createdByUserName: lead.createdByUser.name,
    assignedManagerName: lead.assignedManager?.name ?? null,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt
  };
}

export type CreateLeadInput = {
  partnerId: string;
  createdByUserId: string;
  organizationId?: string | null;
  clientCompanyName: string;
  clientInn?: string | null;
  clientContactName: string;
  clientContactPhone?: string | null;
  clientContactEmail?: string | null;
  subject: string;
  estimatedAmount?: number | null;
  productType?: string[];
  notes?: string | null;
};

export async function createLead(
  prisma: PrismaClient,
  input: CreateLeadInput
): Promise<{ ok: true; lead: Lead } | { ok: false; error: 'org_out_of_scope' }> {
  if (input.organizationId) {
    const org = await prisma.organization.findFirst({
      where: { id: input.organizationId, partnerId: input.partnerId },
      select: { id: true }
    });
    if (!org) return { ok: false, error: 'org_out_of_scope' };
  }

  const lead = await prisma.lead.create({
    data: {
      partnerId: input.partnerId,
      createdByUserId: input.createdByUserId,
      organizationId: input.organizationId ?? null,
      clientCompanyName: input.clientCompanyName.trim(),
      clientInn: input.clientInn?.trim() || null,
      clientContactName: input.clientContactName.trim(),
      clientContactPhone: input.clientContactPhone?.trim() || null,
      clientContactEmail: input.clientContactEmail?.trim() || null,
      subject: input.subject.trim(),
      estimatedAmount: input.estimatedAmount ?? null,
      productType: input.productType ?? [],
      notes: input.notes?.trim() || null,
      status: 'new'
    }
  });
  return { ok: true, lead };
}

export type WithdrawLeadArgs = {
  leadId: string;
  partnerId: string;
  scopeOrgIds?: string[];
  reason: string;
};

export async function withdrawLead(
  prisma: PrismaClient,
  args: WithdrawLeadArgs
): Promise<
  | { ok: true; lead: Lead }
  | { ok: false; error: 'not_found' | 'already_rejected' | 'already_promoted' }
> {
  const lead = await prisma.lead.findFirst({
    where: {
      id: args.leadId,
      partnerId: args.partnerId,
      ...(args.scopeOrgIds && args.scopeOrgIds.length > 0
        ? { OR: [{ organizationId: { in: args.scopeOrgIds } }, { organizationId: null }] }
        : {})
    },
    select: { id: true, status: true }
  });

  if (!lead) return { ok: false, error: 'not_found' };
  if (lead.status === 'rejected') return { ok: false, error: 'already_rejected' };
  if (lead.status === 'promoted_to_order') return { ok: false, error: 'already_promoted' };

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: 'rejected',
      rejectedReason: args.reason.trim() || 'Отозван партнёром'
    }
  });
  return { ok: true, lead: updated };
}
