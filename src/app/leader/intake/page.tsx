import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listIntake } from '@/lib/services/intake/list';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { IntakeTable } from '@/components/intake/intake-table';
import { IntakeFilters } from '@/components/intake/intake-filters';
import { Paginator } from '@/components/ui';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

const TAKE = 50;

export default async function LeaderIntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isFeatureEnabled('intake_inbox')) notFound();
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const skip = Math.max(Number(typeof sp.skip === 'string' ? sp.skip : 0) || 0, 0);
  const assigneeId = typeof sp.assignee === 'string' && sp.assignee ? sp.assignee : null;
  const onlyUnassigned = sp.unassigned === '1';

  const [res, managers] = await Promise.all([
    listIntake(prisma, session, {
      page: Math.floor(skip / TAKE) + 1,
      pageSize: TAKE,
      assigneeId,
      onlyUnassigned,
    }),
    session.companyId ? listCompanyManagers(prisma, session.companyId) : Promise.resolve([]),
  ]);
  if (!res.ok) notFound();

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Входящие в работу"
          subtitle="Неразобранные единицы всей команды. Фильтруйте по ответственному; «залежавшееся» подсвечивается."
        />
      </div>
      <IntakeFilters
        managers={managers.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name }))}
        assigneeId={assigneeId}
        onlyUnassigned={onlyUnassigned}
      />
      <IntakeTable items={res.result.items} viewerPrefix="/leader" currentUserId={session.sub} />
      <Paginator
        basePath="/leader/intake"
        searchParams={sp}
        take={TAKE}
        skip={skip}
        total={res.result.total}
      />
    </div>
  );
}
