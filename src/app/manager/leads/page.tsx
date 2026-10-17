import React from 'react';
import Link from 'next/link';
import { isLeadStatus } from '@/lib/leads/statuses';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listManagerLeads } from '@/lib/services/manager/leads';
import { listCompanyOrgOptions } from '@/lib/services/manager/organizations';
import { ManagerLeadsFilter } from '@/components/manager/manager-leads-filter';
import { ManagerLeadsTable } from '@/components/manager/manager-leads-table';
import { LeadCreateStaffForm } from '@/components/manager/lead-create-staff-form';

import { PageHeader } from '@/components/ui/page-header';
import { ListCapNotice } from '@/components/ui';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getFunnelBoard } from '@/lib/services/funnel/board';
import { FunnelBoard } from '@/components/funnel/funnel-board';
import { SALES_STAGE_LINE } from '@/lib/help/salesStages';
export const dynamic = 'force-dynamic';

type SearchParams = {
  status?: string;
  q?: string;
  assignedToMe?: string;
  cursor?: string;
  /** Этап 6 ТЗ 13.10.2026 (`У-312`): `funnel` — воронка по стадиям вместо списка. */
  view?: string;
};

export default async function ManagerLeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const status = sp.status && isLeadStatus(sp.status) ? sp.status : undefined;
  // Воронка — за прежним флагом `sales_funnel`: выключен — переключателя нет,
  // `?view=funnel` молча даёт список.
  const funnelEnabled = isFeatureEnabled('sales_funnel');
  const funnel = funnelEnabled && sp.view === 'funnel';

  const [list, board, organizations] = await Promise.all([
    funnel
      ? null
      : listManagerLeads(prisma, {
          status,
          search: sp.q,
          assignedToUserId: sp.assignedToMe === '1' ? session.sub : undefined,
          cursor: sp.cursor,
        }),
    funnel ? getFunnelBoard(prisma, session) : null,
    // Организации компании менеджера для необязательной привязки лида (C8);
    // без companyId — пустой список (лид без организации).
    listCompanyOrgOptions(prisma, session),
  ]);
  const rows = list?.rows ?? [];

  return (
    <>
      {/* `У-13`: заголовок, подзаголовок и кнопка не помещаются в одну строку
          телефона (424px против 390px) — на узком экране они идут столбиком. */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <PageHeader
            title="Лиды"
            // `У-288`: нейтрально; `У-311`: чем лид отличается от сделки и заказа.
            subtitle={SALES_STAGE_LINE.leads}
          />
        </div>
        <LeadCreateStaffForm organizations={organizations} />
      </div>
      {/* Этап 6 ТЗ 13.10.2026 (`У-312`): воронка — вид внутри «Лидов». */}
      {funnelEnabled && (
        <nav aria-label="Вид лидов" className="mb-3 flex gap-1">
          <Link
            href="/manager/leads"
            aria-current={funnel ? undefined : 'page'}
            className={`rounded-lg border px-3 py-1.5 text-sm ${funnel ? 'border-gray-200 bg-white text-[#111111]' : 'border-[#F97316] bg-[#F97316] text-white'}`}
          >
            Список
          </Link>
          <Link
            href="/manager/leads?view=funnel"
            aria-current={funnel ? 'page' : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm ${funnel ? 'border-[#F97316] bg-[#F97316] text-white' : 'border-gray-200 bg-white text-[#111111]'}`}
          >
            Воронка
          </Link>
        </nav>
      )}
      {board ? (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Перетаскивайте карточки между стадиями. «Передано в работу» создаёт заказ, «Отказ»
            требует причину.
          </p>
          <FunnelBoard board={board} />
          <ListCapNotice
            shown={board.shown}
            total={board.total}
            hint="Живые лиды идут первыми и не теряются; за пределом — самые старые обработанные, их видно в карточке организации (вкладка «Лиды»)."
          />
        </div>
      ) : (
        <>
          <ManagerLeadsFilter
            query={{ status: sp.status, q: sp.q, assignedToMe: sp.assignedToMe }}
          />
          <ManagerLeadsTable
            rows={rows}
            nextCursor={list?.nextCursor ?? null}
            query={{ status: sp.status, q: sp.q, assignedToMe: sp.assignedToMe }}
          />
        </>
      )}
    </>
  );
}
