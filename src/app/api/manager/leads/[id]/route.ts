import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { getManagerLead } from '@/lib/services/manager/leads';
import { assignLead, setLeadStatus, promoteLead, rejectLead } from '@/lib/services/manager/leadLifecycle';
import type { LeadStatus } from '@prisma/client';

type Params = { params: Promise<{ id: string }> };

const statusFor = (error: 'not_found' | 'lifecycle_violation' | 'invalid_manager'): number =>
  error === 'not_found' ? 404 : error === 'invalid_manager' ? 400 : 409;

export async function GET(_req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;
  const session = await requireManager();
  const { id } = await params;
  const lead = await getManagerLead(prisma, session, id);
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

  if (action === 'assign') {
    const res = await assignLead(prisma, { leadId: id, managerId, assignToUserId: body?.assignToUserId });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: statusFor(res.error) });
    return NextResponse.json({ lead: res.lead });
  }
  if (action === 'setStatus') {
    const res = await setLeadStatus(prisma, { leadId: id, managerId, status: body?.status as LeadStatus });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: statusFor(res.error) });
    return NextResponse.json({ lead: res.lead });
  }
  if (action === 'promote') {
    const res = await promoteLead(prisma, { leadId: id, managerId });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: statusFor(res.error) });
    return NextResponse.json({ lead: res.lead, orderId: res.order.id }, { status: 201 });
  }
  if (action === 'reject') {
    const res = await rejectLead(prisma, { leadId: id, managerId, reason: String(body?.reason ?? '') });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: statusFor(res.error) });
    return NextResponse.json({ lead: res.lead });
  }
  return NextResponse.json({ error: 'Invalid action. Use assign|setStatus|promote|reject' }, { status: 400 });
}
