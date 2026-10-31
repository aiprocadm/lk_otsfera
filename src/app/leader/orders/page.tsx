import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrders } from '@/lib/services/manager/orders';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';
import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';
import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';
import { ExportLink } from '@/components/ui';
import { CreateOrderButton } from '@/components/manager/create-order-button';
import { getOrderedStatuses } from '@/lib/services/orderStatuses';

import { PageHeader } from '@/components/ui/page-header';
import { SALES_STAGE_LINE } from '@/lib/help/salesStages';
import { MissingObjectNotice } from '@/components/ui/missing-object-notice';
import { isMissingObjectRequested } from '@/lib/navigation/missingObject';
export const dynamic = 'force-dynamic';

type SearchParams = {
  search?: string;
  executionStatus?: string;
  financialStatus?: string;
  organizationId?: string;
  unassigned?: string;
  cursor?: string;
  /** `У-232`: пришли по ссылке на удалённый или чужой объект. */
  missing?: string;
};

export default async function LeaderOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const [{ rows, nextCursor }, orgs] = await Promise.all([
    listOrders(prisma, {
      session,
      ...sp,
      unassigned: sp.unassigned === '1',
      teamModeOverride: true,
    }),
    listOrganizations(prisma, session, true),
  ]);
  // §10 ТЗ v0.5: фильтр по рабочему статусу — активные строки справочника.
  const statusOptions = (await getOrderedStatuses(prisma))
    .filter((x) => x.isActive)
    .map((x) => ({ id: x.id, label: x.label }));

  return (
    <>
      <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          {/* `У-311`: чем заказ отличается от лида и сделки (зеркало менеджера). */}
          <PageHeader title="Заказы" subtitle={SALES_STAGE_LINE.orders} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* `У-335` (зеркало `У-306`): тот же диалог, что у менеджера; после
              создания — в карточку заказа своего кабинета. */}
          <CreateOrderButton
            organizations={orgs.map((o) => ({ id: o.id, name: o.name }))}
            ordersHref="/leader/orders"
          />
          {/* ФТ-12.2: `scope=company` повторяет company-wide режим экрана лидера. */}
          <ExportLink
            base="/api/manager/orders/export"
            params={{
              scope: 'company',
              search: sp.search,
              executionStatus: sp.executionStatus,
              financialStatus: sp.financialStatus,
              organizationId: sp.organizationId,
              unassigned: sp.unassigned,
            }}
          />
        </div>
      </div>
      {/* `У-232`: пришли по ссылке на удалённый или чужой заказ. */}
      {isMissingObjectRequested(sp) && <MissingObjectNotice what="Заказ" />}
      <ManagerOrdersFilter initial={sp} statuses={statusOptions} basePath="/leader" />
      <ManagerOrdersTable
        rows={rows}
        nextCursor={nextCursor}
        searchParams={sp}
        basePath="/leader"
      />
      <ManagerOrdersCardList rows={rows} basePath="/leader" />
    </>
  );
}
