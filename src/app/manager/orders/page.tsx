import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrders } from '@/lib/services/manager/orders';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';
import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';
import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';
import { ExportLink } from '@/components/ui';
import { getOrderedStatuses } from '@/lib/services/orderStatuses';

import { PageHeader } from '@/components/ui/page-header';
import { MissingObjectNotice } from '@/components/ui/missing-object-notice';
import { isMissingObjectRequested } from '@/lib/navigation/missingObject';
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

export default async function ManagerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireManager();
  const sp = await searchParams;
  const [{ rows, nextCursor }, orgs] = await Promise.all([
    listOrders(prisma, { session, ...sp, unassigned: sp.unassigned === '1' }),
    listOrganizations(prisma, session),
  ]);
  // §10 ТЗ v0.5: фильтр по рабочему статусу — активные строки справочника.
  const statusOptions = (await getOrderedStatuses(prisma))
    .filter((x) => x.isActive)
    .map((x) => ({ id: x.id, label: x.label }));

  return (
    <>
      <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <PageHeader title="Заказы" subtitle="Заказы ваших организаций" />
        </div>
        {/* ФТ-12.2: выгрузка уважает активные фильтры экрана. */}
        <ExportLink
          base="/api/manager/orders/export"
          params={{
            search: sp.search,
            executionStatus: sp.executionStatus,
            financialStatus: sp.financialStatus,
            organizationId: sp.organizationId,
            unassigned: sp.unassigned,
          }}
        />
      </div>
      {/* `У-232`: пришли по ссылке на удалённый или чужой заказ. */}
      {isMissingObjectRequested(sp) && <MissingObjectNotice what="Заказ" />}
      <ManagerOrdersFilter orgs={orgs} initial={sp} statuses={statusOptions} />
      <ManagerOrdersTable rows={rows} nextCursor={nextCursor} searchParams={sp} />
      <ManagerOrdersCardList rows={rows} />
    </>
  );
}
