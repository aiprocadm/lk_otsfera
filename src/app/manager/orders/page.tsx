import React from 'react';
import Link from 'next/link';
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
import { ORDER_FOCUS_LABEL, isOrderFocus } from '@/lib/orders/focus';
type SearchParams = {
  search?: string;
  executionStatus?: string;
  financialStatus?: string;
  organizationId?: string;
  unassigned?: string;
  /** Этап 4 ТЗ 13.10.2026 (`У-295`, `У-297`): переход с карточки главной. */
  focus?: string;
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
  // Незнакомый фокус из адреса — как будто его нет, а не ошибка схемы.
  const { focus: rawFocus, ...rest } = sp;
  const focus = isOrderFocus(rawFocus) ? rawFocus : undefined;
  const [{ rows, nextCursor }, orgs] = await Promise.all([
    listOrders(prisma, {
      session,
      ...rest,
      unassigned: sp.unassigned === '1',
      ...(focus ? { focus } : {}),
    }),
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
            focus,
          }}
        />
      </div>
      {/* `Р-4-3`: человек пришёл с карточки главной — видно, что список
          отфильтрован и как вернуться ко всем заказам. */}
      {focus && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm"
          data-testid="orders-focus"
        >
          <span className="text-gray-700">
            Показаны: <span className="font-medium text-[#111111]">{ORDER_FOCUS_LABEL[focus]}</span>
          </span>
          <Link href="/manager/orders" className="ml-auto text-[#EA580C] hover:underline">
            Сбросить
          </Link>
        </div>
      )}
      {/* `У-232`: пришли по ссылке на удалённый или чужой заказ. */}
      {isMissingObjectRequested(sp) && <MissingObjectNotice what="Заказ" />}
      <ManagerOrdersFilter
        orgs={orgs}
        initial={{ ...rest, ...(focus ? { focus } : {}) }}
        statuses={statusOptions}
      />
      <ManagerOrdersTable
        rows={rows}
        nextCursor={nextCursor}
        searchParams={{ ...rest, ...(focus ? { focus } : {}) }}
      />
      <ManagerOrdersCardList rows={rows} />
    </>
  );
}
