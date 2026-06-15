import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { listManagerLeads } from '@/lib/services/manager/leads';
import type { LeadStatus } from '@prisma/client';

const STATUSES = ['new', 'in_review', 'qualified', 'promoted_to_order', 'rejected'];

export async function GET(req: Request) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const sp = new URL(req.url).searchParams;
  const statusRaw = sp.get('status');
  const status = statusRaw && STATUSES.includes(statusRaw) ? (statusRaw as LeadStatus) : undefined;

  const result = await listManagerLeads(prisma, {
    status,
    search: sp.get('q') ?? undefined,
    assignedToUserId: sp.get('assignedToMe') === '1' ? session.sub : undefined,
    cursor: sp.get('cursor') ?? undefined
  });
  return NextResponse.json(result);
}
