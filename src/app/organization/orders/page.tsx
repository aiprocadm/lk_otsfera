import type { ExecutionStatus, FinancialStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgOrdersFilter } from '@/components/organization/org-orders-filter';
import {
  OrgOrdersTable,
  OrgOrdersCardList
} from '@/components/organization/org-orders-table';
import { listOrgOrders } from '@/lib/services/organization/orders';

type SearchParams = {
  org?: string;
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

export default async function OrganizationOrdersPage({
  searchParams
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

  const { rows, total } = await listOrgOrders(prisma, {
    organizationId: ctx.activeOrgId,
    search: sp.search,
    executionStatus,
    financialStatus,
    take,
    skip
  });

  const page = Math.floor(skip / take) + 1;
  const pages = Math.max(1, Math.ceil(total / take));

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className='space-y-4'>
        <div>
          <h1 className='text-2xl font-semibold text-[#111111]'>Заказы</h1>
          <p className='text-sm text-gray-500 mt-0.5'>
            {total} {pluralize(total, 'заказ', 'заказа', 'заказов')} · {ctx.activeOrgName}
          </p>
        </div>

        <OrgOrdersFilter />

        <OrgOrdersTable rows={rows} orgParam={sp.org ?? null} />
        <OrgOrdersCardList rows={rows} orgParam={sp.org ?? null} />

        {pages > 1 && (
          <Paginator
            take={take}
            skip={skip}
            page={page}
            pages={pages}
            total={total}
            searchParams={sp}
          />
        )}
      </div>
    </OrgAppShell>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function Paginator({
  take,
  skip,
  page,
  pages,
  total,
  searchParams
}: {
  take: number;
  skip: number;
  page: number;
  pages: number;
  total: number;
  searchParams: SearchParams;
}) {
  function link(targetSkip: number): string {
    const params = new URLSearchParams();
    if (searchParams.org) params.set('org', searchParams.org);
    if (searchParams.search) params.set('search', searchParams.search);
    if (searchParams.execution) params.set('execution', searchParams.execution);
    if (searchParams.financial) params.set('financial', searchParams.financial);
    params.set('take', String(take));
    if (targetSkip > 0) params.set('skip', String(targetSkip));
    return `/organization/orders${params.toString() ? '?' + params.toString() : ''}`;
  }

  const prev = Math.max(0, skip - take);
  const next = Math.min((pages - 1) * take, skip + take);

  return (
    <div className='flex items-center justify-between text-sm text-gray-500'>
      <span>
        Страница {page} из {pages} · {total} всего
      </span>
      <div className='flex gap-2'>
        {skip > 0 && (
          <a
            href={link(prev)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Назад
          </a>
        )}
        {skip + take < total && (
          <a
            href={link(next)}
            className='px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50'
          >
            Вперёд
          </a>
        )}
      </div>
    </div>
  );
}
