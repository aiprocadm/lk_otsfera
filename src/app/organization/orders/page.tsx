import React from 'react';
import type { ExecutionStatus, FinancialStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgOrdersFilter } from '@/components/organization/org-orders-filter';
import { OrgOrdersTable, OrgOrdersCardList } from '@/components/organization/org-orders-table';
import { listOrgOrders } from '@/lib/services/organization/orders';
import { orgOrderScope } from '@/lib/services/organization/memberScope';
import { pluralizeRu } from '@/lib/format';
import { Paginator } from '@/components/ui';

import { PageHeader } from '@/components/ui/page-header';
import { MissingObjectNotice } from '@/components/ui/missing-object-notice';
import { isMissingObjectRequested, MISSING_OBJECT_PARAM } from '@/lib/navigation/missingObject';
type SearchParams = {
  org?: string;
  search?: string;
  execution?: string;
  financial?: string;
  take?: string;
  skip?: string;
  /** `У-232`: пришли по ссылке на удалённый или чужой объект. */
  missing?: string;
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

export default async function OrganizationOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

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

  // `У-236`: граница участника считается один раз и уходит в сервис.
  const scope = await orgOrderScope(prisma, ctx.session, ctx.activeOrgId);

  const { rows, total } = await listOrgOrders(prisma, {
    organizationId: ctx.activeOrgId,
    scope,
    search: sp.search,
    executionStatus,
    financialStatus,
    take,
    skip,
  });

  return (
    <OrgAppShell
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-4">
        <div>
          <PageHeader
            title="Заказы"
            subtitle={
              <>
                {total} {pluralizeRu(total, 'заказ', 'заказа', 'заказов')} · {ctx.activeOrgName}
              </>
            }
          />
        </div>

        {/* `У-232`: пришли по ссылке на удалённый или чужой заказ. */}
        {isMissingObjectRequested(sp) && <MissingObjectNotice what="Заказ" />}

        <OrgOrdersFilter />

        <OrgOrdersTable rows={rows} orgParam={sp.org ?? null} />
        <OrgOrdersCardList rows={rows} orgParam={sp.org ?? null} />

        <Paginator
          basePath="/organization/orders"
          /* Пометку «объект недоступен» на соседние страницы не переносим. */
          searchParams={{ ...sp, [MISSING_OBJECT_PARAM]: undefined }}
          take={take}
          skip={skip}
          total={total}
        />
      </div>
    </OrgAppShell>
  );
}
