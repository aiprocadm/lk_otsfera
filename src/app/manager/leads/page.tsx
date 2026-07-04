import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listManagerLeads } from '@/lib/services/manager/leads';
import { ManagerLeadsFilter } from '@/components/manager/manager-leads-filter';
import { ManagerLeadsTable } from '@/components/manager/manager-leads-table';
import type { LeadStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

type SearchParams = { status?: string; q?: string; assignedToMe?: string; cursor?: string };

const STATUSES = ['new', 'in_review', 'qualified', 'promoted_to_order', 'rejected'];

export default async function ManagerLeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireManager();
  const sp = await searchParams;
  const status = sp.status && STATUSES.includes(sp.status) ? (sp.status as LeadStatus) : undefined;

  const { rows, nextCursor } = await listManagerLeads(prisma, {
    status,
    search: sp.q,
    assignedToUserId: sp.assignedToMe === '1' ? session.sub : undefined,
    cursor: sp.cursor
  });

  return (
    <>
      <h1 className='mb-4 text-2xl font-semibold'>Заявки</h1>
      <ManagerLeadsFilter query={{ status: sp.status, q: sp.q, assignedToMe: sp.assignedToMe }} />
      <ManagerLeadsTable rows={rows} nextCursor={nextCursor} query={{ status: sp.status, q: sp.q, assignedToMe: sp.assignedToMe }} />
    </>
  );
}