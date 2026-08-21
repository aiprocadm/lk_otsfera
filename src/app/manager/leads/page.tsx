import React from 'react';
import { isLeadStatus } from '@/lib/leads/statuses';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listManagerLeads } from '@/lib/services/manager/leads';
import { listCompanyOrgOptions } from '@/lib/services/manager/organizations';
import { ManagerLeadsFilter } from '@/components/manager/manager-leads-filter';
import { ManagerLeadsTable } from '@/components/manager/manager-leads-table';
import { LeadCreateStaffForm } from '@/components/manager/lead-create-staff-form';

export const dynamic = 'force-dynamic';

type SearchParams = { status?: string; q?: string; assignedToMe?: string; cursor?: string };

export default async function ManagerLeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const status = sp.status && isLeadStatus(sp.status) ? sp.status : undefined;

  const [{ rows, nextCursor }, organizations] = await Promise.all([
    listManagerLeads(prisma, {
      status,
      search: sp.q,
      assignedToUserId: sp.assignedToMe === '1' ? session.sub : undefined,
      cursor: sp.cursor,
    }),
    // Организации компании менеджера для необязательной привязки лида (C8);
    // без companyId — пустой список (лид без организации).
    listCompanyOrgOptions(prisma, session),
  ]);

  return (
    <>
      {/* `У-13`: заголовок, подзаголовок и кнопка не помещаются в одну строку
          телефона (424px против 390px) — на узком экране они идут столбиком. */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Лиды</h1>
          {/* `У-73`: одна строка «что здесь делают». */}
          <p className="text-sm text-gray-500 mt-0.5">
            Возможные продажи — внутренние карточки, клиент их не видит
          </p>
        </div>
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
