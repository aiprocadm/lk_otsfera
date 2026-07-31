import React from 'react';
import type { LeadStatus } from '@prisma/client';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listManagerLeads } from '@/lib/services/manager/leads';
import { ManagerLeadsFilter } from '@/components/manager/manager-leads-filter';
import { ManagerLeadsTable } from '@/components/manager/manager-leads-table';
import { LeadCreateStaffForm } from '@/components/manager/lead-create-staff-form';

export const dynamic = 'force-dynamic';

type SearchParams = { status?: string; q?: string; assignedToMe?: string; cursor?: string };

const STATUSES = ['new', 'in_review', 'qualified', 'promoted_to_order', 'rejected'];

export default async function ManagerLeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const status = sp.status && STATUSES.includes(sp.status) ? (sp.status as LeadStatus) : undefined;

  const [{ rows, nextCursor }, organizations] = await Promise.all([
    listManagerLeads(prisma, {
      status,
      search: sp.q,
      assignedToUserId: sp.assignedToMe === '1' ? session.sub : undefined,
      cursor: sp.cursor,
    }),
    // Организации компании менеджера для необязательной привязки лида (C8);
    // без companyId — пустой список (лид без организации).
    session.companyId
      ? prisma.organization.findMany({
          where: { companyId: session.companyId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Лиды</h1>
        <LeadCreateStaffForm organizations={organizations} />
      </div>
      <ManagerLeadsFilter query={{ status: sp.status, q: sp.q, assignedToMe: sp.assignedToMe }} />
      <ManagerLeadsTable
        rows={rows}
        nextCursor={nextCursor}
        query={{ status: sp.status, q: sp.q, assignedToMe: sp.assignedToMe }}
      />
    </>
  );
}
