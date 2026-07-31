import React from 'react';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listIntake } from '@/lib/services/intake/list';
import { IntakeTable } from '@/components/intake/intake-table';
import { IntakeFilters } from '@/components/intake/intake-filters';
import { Paginator } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TAKE = 50;

/** Админ-зеркало Intake (Model A): вся платформа, фильтры как у руководителя. */
export default async function AdminIntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isFeatureEnabled('intake_inbox')) notFound();
  const session = await requireAdmin();
  const sp = await searchParams;
  const skip = Math.max(Number(typeof sp.skip === 'string' ? sp.skip : 0) || 0, 0);
  const assigneeId = typeof sp.assignee === 'string' && sp.assignee ? sp.assignee : null;
  const onlyUnassigned = sp.unassigned === '1';

  const [res, staff] = await Promise.all([
    listIntake(prisma, session, {
      page: Math.floor(skip / TAKE) + 1,
      pageSize: TAKE,
      assigneeId,
      onlyUnassigned,
    }),
    prisma.user.findMany({
      where: { role: 'manager', isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
  ]);
  if (!res.ok) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Входящие в работу</h1>
        <p className="text-sm text-gray-500 mt-1">Неразобранные единицы по всей платформе.</p>
      </div>
      <IntakeFilters managers={staff} assigneeId={assigneeId} onlyUnassigned={onlyUnassigned} />
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
