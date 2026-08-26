import React from 'react';
import type { ExecutionStatus, FinancialStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { listPartnerOrders } from '@/lib/services/partner/orders';
import { PartnerOrdersFilter } from '@/components/partner/orders-filter';
import { PartnerOrdersTable } from '@/components/partner/orders-table';
import { PartnerOrdersCardList } from '@/components/partner/orders-card-list';
import { pluralizeRu } from '@/lib/format';
import { Paginator } from '@/components/ui';

import { PageHeader } from '@/components/ui/page-header';
type SearchParams = {
  search?: string;
  execution?: string;
  financial?: string;
  take?: string;
  skip?: string;
};

const VALID_EXECUTION: ExecutionStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
  'on_hold',
];
const VALID_FINANCIAL: FinancialStatus[] = [
  'not_billed',
  'billed',
  'partially_paid',
  'paid',
  'refunded',
];

const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

export default async function PartnerDealsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requirePartner();

  const sp = await searchParams;
  const take = Math.min(
    Number.isFinite(Number(sp.take)) ? Number(sp.take) : DEFAULT_TAKE,
    MAX_TAKE
  );
  const skip = Number.isFinite(Number(sp.skip)) ? Number(sp.skip) : 0;

  const executionStatus = VALID_EXECUTION.includes(sp.execution as ExecutionStatus)
    ? (sp.execution as ExecutionStatus)
    : undefined;
  const financialStatus = VALID_FINANCIAL.includes(sp.financial as FinancialStatus)
    ? (sp.financial as FinancialStatus)
    : undefined;

  const scope =
    session.assignedOrgIds && session.assignedOrgIds.length > 0
      ? session.assignedOrgIds
      : undefined;

  const { rows, total } = await listPartnerOrders(prisma, {
    partnerId: session.partnerId,
    scopeOrgIds: scope,
    search: sp.search,
    executionStatus,
    financialStatus,
    take,
    skip,
  });

  return (
    <div className="space-y-4">
      <div>
        <PageHeader
          title="Заказы"
          subtitle={
            <>
              {total} {pluralizeRu(total, 'заказ', 'заказа', 'заказов')}
            </>
          }
        />
      </div>

      <PartnerOrdersFilter />

      <PartnerOrdersTable rows={rows} />
      <PartnerOrdersCardList rows={rows} />

      <Paginator
        basePath="/partner/orders"
        searchParams={sp}
        take={take}
        skip={skip}
        total={total}
      />
    </div>
  );
}
