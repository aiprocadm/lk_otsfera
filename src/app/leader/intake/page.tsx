import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listIntake } from '@/lib/services/intake/list';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { IntakeTable } from '@/components/intake/intake-table';
import { IntakeFilters } from '@/components/intake/intake-filters';
import { Paginator } from '@/components/ui';

import { PageHeader } from '@/components/ui/page-header';
import { IntakeChannelFilter } from '@/components/intake/intake-channel-filter';
import { parseIntakeView } from '@/lib/intake/intakeView';
import { INBOUND_SECTION_LINE } from '@/lib/help/inboundSections';
export const dynamic = 'force-dynamic';

const TAKE = 50;

export default async function LeaderIntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const skip = Math.max(Number(typeof sp.skip === 'string' ? sp.skip : 0) || 0, 0);
  const view = parseIntakeView(sp);
  const assigneeId = typeof sp.assignee === 'string' && sp.assignee ? sp.assignee : null;
  const onlyUnassigned = sp.unassigned === '1';

  const [res, managers] = await Promise.all([
    listIntake(prisma, session, {
      page: Math.floor(skip / TAKE) + 1,
      ...(view.channel ? { channel: view.channel } : {}),
      onlyImportant: view.onlyImportant,
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
        {/* `У-318`: «Входящие обращения» — только внешние каналы. */}
        <PageHeader title="Входящие обращения" subtitle={INBOUND_SECTION_LINE.intake} />
      </div>
      <IntakeFilters
        managers={managers.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name }))}
        assigneeId={assigneeId}
        onlyUnassigned={onlyUnassigned}
      />
      <IntakeChannelFilter
        basePath="/leader/intake"
        searchParams={sp}
        channel={view.channel}
        onlyImportant={view.onlyImportant}
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
