import React from 'react';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listIntake } from '@/lib/services/intake/list';
import { listActiveManagerOptions } from '@/lib/services/admin/users';
import { IntakeTable } from '@/components/intake/intake-table';
import { IntakeFilters } from '@/components/intake/intake-filters';
import { Paginator } from '@/components/ui';

import { PageHeader } from '@/components/ui/page-header';
import { IntakeChannelFilter } from '@/components/intake/intake-channel-filter';
import { parseIntakeView } from '@/lib/intake/intakeView';
export const dynamic = 'force-dynamic';

const TAKE = 50;

/** Админ-зеркало Intake (Model A): вся платформа, фильтры как у руководителя. */
export default async function AdminIntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdmin();
  const sp = await searchParams;
  const skip = Math.max(Number(typeof sp.skip === 'string' ? sp.skip : 0) || 0, 0);
  const view = parseIntakeView(sp);
  const assigneeId = typeof sp.assignee === 'string' && sp.assignee ? sp.assignee : null;
  const onlyUnassigned = sp.unassigned === '1';

  const [res, staff] = await Promise.all([
    listIntake(prisma, session, {
      page: Math.floor(skip / TAKE) + 1,
      ...(view.channel ? { channel: view.channel } : {}),
      onlyImportant: view.onlyImportant,
      pageSize: TAKE,
      assigneeId,
      onlyUnassigned,
    }),
    listActiveManagerOptions(prisma),
  ]);
  if (!res.ok) notFound();

  return (
    <div className="space-y-6">
      <div>
        {/* `У-318`: «Входящие обращения» — только внешние каналы. */}
        <PageHeader
          title="Входящие обращения"
          subtitle="Неразобранные сообщения, письма и звонки по всей платформе."
        />
      </div>
      <IntakeFilters managers={staff} assigneeId={assigneeId} onlyUnassigned={onlyUnassigned} />
      <IntakeChannelFilter
        basePath="/admin/intake"
        searchParams={sp}
        channel={view.channel}
        onlyImportant={view.onlyImportant}
      />
      <IntakeTable items={res.result.items} viewerPrefix="/admin" currentUserId={session.sub} />
      <Paginator
        basePath="/admin/intake"
        searchParams={sp}
        take={TAKE}
        skip={skip}
        total={res.result.total}
      />
    </div>
  );
}
