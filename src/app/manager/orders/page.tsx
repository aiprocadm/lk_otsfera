import React from 'react';
import Link from 'next/link';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrders, listOrderKanban } from '@/lib/services/manager/orders';
import { ManagerOrdersKanban } from '@/components/manager/manager-orders-kanban';
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
import { ORDER_FOCUS_LABEL, isOrderFocus } from '@/lib/orders/focus';
type SearchParams = {
  search?: string;
  executionStatus?: string;
  financialStatus?: string;
  organizationId?: string;
  unassigned?: string;
  /** Этап 4 ТЗ 13.10.2026 (`У-295`, `У-297`): переход с карточки главной. */
  focus?: string;
  /** Этап 6 ТЗ 13.10.2026 (`У-303`): `kanban` — доска по этапам. */
  view?: string;
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
  const { focus: rawFocus, view: rawView, ...rest } = sp;
  const focus = isOrderFocus(rawFocus) ? rawFocus : undefined;
  const kanban = rawView === 'kanban';
  const query = {
    session,
    ...rest,
    unassigned: sp.unassigned === '1',
    ...(focus ? { focus } : {}),
  };
  // Вид выбирает, что грузить: список постранично или доску целиком (до предела).
  const [list, board, orgs] = await Promise.all([
    kanban ? null : listOrders(prisma, query),
    kanban ? listOrderKanban(prisma, query) : null,
    listOrganizations(prisma, session),
  ]);
  const rows = list?.rows ?? [];
  // Ссылки переключателя сохраняют фильтры экрана, но не страницу списка.
  const viewHref = (v: 'list' | 'kanban') => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries({ ...rest, ...(focus ? { focus } : {}) })) {
      if (typeof val === 'string' && val && k !== 'cursor' && k !== 'missing') q.set(k, val);
    }
    if (v === 'kanban') q.set('view', 'kanban');
    const qs = q.toString();
    return qs ? `/manager/orders?${qs}` : '/manager/orders';
  };
  // §10 ТЗ v0.5: фильтр по рабочему статусу — активные строки справочника.
  const statusOptions = (await getOrderedStatuses(prisma))
    .filter((x) => x.isActive)
    .map((x) => ({ id: x.id, label: x.label }));

  return (
    <>
      <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          {/* `У-311`: чем заказ отличается от лида и сделки. */}
          <PageHeader title="Заказы" subtitle={SALES_STAGE_LINE.orders} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Этап 6 ТЗ 13.10.2026 (`У-306`): заказ без лида — рядом с выгрузкой. */}
          <CreateOrderButton organizations={orgs.map((o) => ({ id: o.id, name: o.name }))} />
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
      {/* Этап 6 ТЗ 13.10.2026 (`У-303`): «Список / Канбан». */}
      <nav aria-label="Вид заказов" className="my-3 flex gap-1">
        <Link
          href={viewHref('list')}
          aria-current={kanban ? undefined : 'page'}
          className={`rounded-lg border px-3 py-1.5 text-sm ${kanban ? 'border-gray-200 bg-white text-[#111111]' : 'border-[#F97316] bg-[#F97316] text-white'}`}
        >
          Список
        </Link>
        <Link
          href={viewHref('kanban')}
          aria-current={kanban ? 'page' : undefined}
          className={`rounded-lg border px-3 py-1.5 text-sm ${kanban ? 'border-[#F97316] bg-[#F97316] text-white' : 'border-gray-200 bg-white text-[#111111]'}`}
        >
          Канбан
        </Link>
      </nav>
      {board ? (
        <>
          {board.total > board.shown && (
            <p className="mb-2 text-xs text-gray-500">
              На доске — {board.shown} последних из {board.total}. Сузьте поиск или фильтр, чтобы
              увидеть остальные.
            </p>
          )}
          <ManagerOrdersKanban board={board} />
        </>
      ) : (
        <>
          <ManagerOrdersTable
            rows={rows}
            nextCursor={list?.nextCursor ?? null}
            searchParams={{ ...rest, ...(focus ? { focus } : {}) }}
          />
          <ManagerOrdersCardList rows={rows} />
        </>
      )}
    </>
  );
}
