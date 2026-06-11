import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { requirePartner } from '@/lib/auth/guard';
import { getLead, withdrawLead } from '@/lib/services/partner/leads';
import { recordAudit } from '@/lib/auth/audit';
import { notFoundIfDisabled } from '@/lib/featureFlags';

const patchSchema = z.object({
  action: z.literal('withdraw'),
  reason: z.string().trim().max(500).optional()
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const disabled = notFoundIfDisabled('partner_leads');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult.response;

  const { id } = await params;
  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const lead = await getLead(prisma, {
    leadId: id,
    partnerId: partnerResult.value.partnerId,
    scopeOrgIds: scope
  });

  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(lead);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const disabled = notFoundIfDisabled('partner_leads');
  if (disabled) return disabled;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const partnerResult = requirePartner(session);
  if (!partnerResult.ok) return partnerResult.response;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  try {
    const lead = await withdrawLead(prisma, {
      leadId: id,
      partnerId: partnerResult.value.partnerId,
      scopeOrgIds: scope,
      reason: parsed.data.reason ?? ''
    });

    await recordAudit(prisma, {
      action: 'lead_withdrawn',
      entity: 'lead',
      entityId: lead.id,
      userId: session.sub,
      reason: lead.rejectedReason ?? undefined,
      after: {
        partnerId: partnerResult.value.partnerId,
      },
    });

    return NextResponse.json({ id: lead.id, status: lead.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (msg.startsWith('ALREADY_REJECTED')) return NextResponse.json({ error: 'ALREADY_REJECTED' }, { status: 409 });
    if (msg.startsWith('ALREADY_PROMOTED')) return NextResponse.json({ error: 'ALREADY_PROMOTED' }, { status: 409 });
    throw err;
  }
}
