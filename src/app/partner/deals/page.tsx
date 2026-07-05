import React from 'react';
import type { ExecutionStatus, FinancialStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { listPartnerDeals } from '@/lib/services/partner/deals';
import { DealsFilter } from '@/components/partner/deals-filter';
import { DealsTable } from '@/components/partner/deals-table';
import { DealsCardList } from '@/components/partner/deals-card-list';
import { pluralizeRu } from '@/lib/format';
import { Paginator } from '@/components/ui';

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
  'on_hold'
];
const VALID_FINANCIAL: FinancialStatus[] = [
  'not_billed',
  'billed',
  'partially_paid',
  'paid',
  'refunded'
];

const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

export default async function PartnerDealsPage({
  searchParams
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

  const scope = session.assignedOrgIds && session.assignedOrgIds.length > 0
    ? session.assignedOrgIds
    : undefined;

  const { rows, total } = await listPartnerDeals(prisma, {
    partnerId: session.partnerId,
    scopeOrgIds: scope,
    search: sp.search,
    executionStatus,
    financialStatus,
    take,
    skip
  });

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-semibold text-[#111111]'>Заказы</h1>
        <p className='text-sm text-gray-500 mt-0.5'>
          {total} {pluralizeRu(total, 'заказ', 'заказа', 'заказов')}
        </p>
      </div>

      <DealsFilter />

      <DealsTable rows={rows} />
      <DealsCardList rows={rows} />

      <Paginator basePath='/partner/deals' searchParams={sp} take={take} skip={skip} total={total} />
    </div>
  );
}

