import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { LeadStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { listLeads, createLead } from '@/lib/services/partner/leads';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { recordAudit } from '@/lib/auth/audit';

const VALID_STATUS: LeadStatus[] = [
  'new',
  'in_review',
  'qualified',
  'promoted_to_order',
  'rejected'
];

const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

const createSchema = z.object({
  organizationId: z.string().min(1).max(64).optional().nullable(),
  clientCompanyName: z.string().trim().min(1).max(255),
  clientInn: z.string().trim().max(20).optional().nullable(),
  clientContactName: z.string().trim().min(1).max(255),
  clientContactPhone: z.string().trim().max(64).optional().nullable(),
  clientContactEmail: z.string().trim().email().optional().nullable().or(z.literal('')),
  subject: z.string().trim().min(1).max(500),
  estimatedAmount: z.number().nonnegative().optional().nullable(),
  productType: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  notes: z.string().trim().max(2000).optional().nullable()
});

export async function GET(req: Request) {
  const disabled = notFoundIfDisabled('partner_leads');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult.response;

  const url = new URL(req.url);
  const sp = url.searchParams;

  const statusRaw = sp.get('status') ?? undefined;
  const status = statusRaw && VALID_STATUS.includes(statusRaw as LeadStatus)
    ? (statusRaw as LeadStatus)
    : undefined;
  const search = sp.get('search') ?? undefined;

  const takeRaw = Number(sp.get('take') ?? DEFAULT_TAKE);
  const skipRaw = Number(sp.get('skip') ?? 0);
  const take = Math.min(Number.isFinite(takeRaw) && takeRaw > 0 ? takeRaw : DEFAULT_TAKE, MAX_TAKE);
  const skip = Number.isFinite(skipRaw) && skipRaw >= 0 ? skipRaw : 0;

  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const result = await listLeads(prisma, {
    partnerId: partnerResult.value.partnerId,
    scopeOrgIds: scope,
    status,
    search,
    take,
    skip
  });

  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('partner_leads');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult.response;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  if (data.organizationId && scope && !scope.includes(data.organizationId)) {
    return NextResponse.json({ error: 'org_out_of_scope' }, { status: 422 });
  }

  const created = await createLead(prisma, {
    partnerId: partnerResult.value.partnerId,
    createdByUserId: session.sub,
    organizationId: data.organizationId ?? null,
    clientCompanyName: data.clientCompanyName,
    clientInn: data.clientInn ?? null,
    clientContactName: data.clientContactName,
    clientContactPhone: data.clientContactPhone ?? null,
    clientContactEmail: data.clientContactEmail || null,
    subject: data.subject,
    estimatedAmount: data.estimatedAmount ?? null,
    productType: data.productType ?? [],
    notes: data.notes ?? null
  });

  if (!created.ok) {
    const status = created.error === 'org_out_of_scope' ? 422 : 400;
    return NextResponse.json({ error: created.error }, { status });
  }

  const lead = created.lead;
  await recordAudit(prisma, {
    action: 'lead_created',
    entity: 'lead',
    entityId: lead.id,
    userId: session.sub,
    after: {
      partnerId: partnerResult.value.partnerId,
      clientCompanyName: lead.clientCompanyName,
      subject: lead.subject,
    },
  });

  return NextResponse.json({ id: lead.id, status: lead.status }, { status: 201 });
}
