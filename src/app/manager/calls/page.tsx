import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listCalls, type CallsFilters } from '@/lib/services/telephony/listCalls';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { CallsFiltersBar } from '@/components/manager/calls-filters';
import { CallsOrgFilter } from '@/components/manager/calls-org-filter';
import { CallsList } from '@/components/manager/calls-list';
import { Paginator } from '@/components/ui';

export const dynamic = 'force-dynamic';

type SearchParams = {
  direction?: string;
  orgId?: string;
  skip?: string;
};

const PAGE_SIZE = 25;

export default async function ManagerCallsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!isFeatureEnabled('telephony_mango')) notFound();

  const session = await requireManager();
  const sp = await searchParams;

  // skip-конвенция общего Paginator (см. organization/orders): page выводится из skip
  const skip = Number.isFinite(Number(sp.skip)) ? Math.max(0, Number(sp.skip)) : 0;
  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const direction =
    sp.direction === 'inbound' || sp.direction === 'outbound' ? sp.direction : undefined;
  const filters: CallsFilters = {
    ...(direction ? { direction } : {}),
    ...(sp.orgId ? { orgId: sp.orgId } : {}),
    page,
    pageSize: PAGE_SIZE,
  };

  // Организации нужны безусловно (org-фильтр журнала); флаг `contacts` гейтит
  // только triage-формы в CallsList (M2 PR-A), не сам список организаций.
  const contactsEnabled = isFeatureEnabled('contacts');
  const [{ items, total }, orgs] = await Promise.all([
    listCalls(prisma, session, filters),
    listOrganizations(prisma, session),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Звонки</h1>
        <p className="mt-1 text-sm text-gray-500">
          Журнал звонков телефонии. Запись доступна после проверки антивирусом.
        </p>
      </div>

      <CallsFiltersBar direction={direction} orgId={sp.orgId}>
        <CallsOrgFilter orgs={orgs} orgId={sp.orgId} direction={direction} />
      </CallsFiltersBar>

      <CallsList
        items={items}
        orgs={orgs}
        contactsEnabled={contactsEnabled}
        currentUserId={session.sub}
      />

      <Paginator
        basePath="/manager/calls"
        searchParams={sp}
        take={PAGE_SIZE}
        skip={(page - 1) * PAGE_SIZE}
        total={total}
      />
    </div>
  );
}
