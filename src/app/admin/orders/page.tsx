import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrdersForAdmin, listCompanyOptions } from '@/lib/services/admin/orders';
import { getOrderedStatuses } from '@/lib/services/orderStatuses';
import { ManagerOrdersFilter } from '@/components/manager/manager-orders-filter';
import { ManagerOrdersTable } from '@/components/manager/manager-orders-table';
import { ManagerOrdersCardList } from '@/components/manager/manager-orders-card-list';
import { sectionLabel } from '@/lib/navigation/sectionLabels';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

type SearchParams = {
  search?: string;
  statusId?: string;
  financialStatus?: string;
  organizationId?: string;
  companyId?: string;
  unassigned?: string;
  cursor?: string;
};

/**
 * Список заказов администратора (`У-112`).
 *
 * Раньше `/admin/orders` молча уводил на дашборд: пункт меню был, раздела не
 * было. Посмотреть заказы **всех компаний** в одном месте было негде — админ
 * шёл в чужой кабинет (где его встречал page-гард) или в базу.
 *
 * Экран собран теми же компонентами, что у менеджера (правило зеркала §0.2);
 * различие одно и оно про данные: у админа есть колонка и фильтр «Компания» —
 * он смотрит на все компании сразу, а менеджер всегда внутри одной.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const [{ rows, nextCursor }, companies, statuses] = await Promise.all([
    listOrdersForAdmin(prisma, { ...sp, unassigned: sp.unassigned === '1' }),
    listCompanyOptions(prisma),
    getOrderedStatuses(prisma),
  ]);

  const statusOptions = statuses
    .filter((x) => x.isActive)
    .map((x) => ({ id: x.id, label: x.label }));

  return (
    <>
      <div className="mb-4">
        <PageHeader title={sectionLabel('orders')} subtitle="Заказы всех компаний в одном списке" />
      </div>
      <ManagerOrdersFilter
        companies={companies}
        initial={sp}
        statuses={statusOptions}
        basePath="/admin"
      />
      <ManagerOrdersTable
        rows={rows}
        nextCursor={nextCursor}
        searchParams={sp}
        basePath="/admin"
        showCompany
      />
      <ManagerOrdersCardList rows={rows} basePath="/admin" />
    </>
  );
}
