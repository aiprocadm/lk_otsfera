import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { getManagerLead } from '@/lib/services/manager/leads';
import { assignLead, setLeadStatus, promoteLead, rejectLead } from '@/lib/services/manager/leadLifecycle';
import type { LeadStatus } from '@prisma/client';

type Params = { params: Promise<{ id: string }> };

function mapError(err: unknown): NextResponse {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: msg }, { status: 404 });
  if (msg.startsWith('LIFECYCLE_VIOLATION')) return NextResponse.json({ error: msg }, { status: 409 });
  throw err;
}

export async function GET(_req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;
  await requireManager();
  const { id } = await params;
  const lead = await getManagerLead(prisma, id);
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ lead });
}

export async function PATCH(req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;
  const session = await requireManager();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action;
  const managerId = session.sub;

  try {
    if (action === 'assign') {
      const lead = await assignLead(prisma, { leadId: id, managerId, assignToUserId: body?.assignToUserId });
      return NextResponse.json({ lead });
    }
    if (action === 'setStatus') {
      const lead = await setLeadStatus(prisma, { leadId: id, managerId, status: body?.status as LeadStatus });
      return NextResponse.json({ lead });
    }
    if (action === 'promote') {
      const { order, lead } = await promoteLead(prisma, { leadId: id, managerId });
      return NextResponse.json({ lead, orderId: order.id }, { status: 201 });
    }
    if (action === 'reject') {
      const lead = await rejectLead(prisma, { leadId: id, managerId, reason: String(body?.reason ?? '') });
      return NextResponse.json({ lead });
    }
    return NextResponse.json({ error: 'Invalid action. Use assign|setStatus|promote|reject' }, { status: 400 });
  } catch (err) {
    return mapError(err);
  }
}
