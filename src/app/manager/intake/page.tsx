import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listIntake } from '@/lib/services/intake/list';
import { IntakeTable } from '@/components/intake/intake-table';
import { Paginator } from '@/components/ui';

export const dynamic = 'force-dynamic';

const TAKE = 50;

export default async function ManagerIntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isFeatureEnabled('intake_inbox')) notFound();
  const session = await requireManager();
  const sp = await searchParams;
  const skip = Math.max(Number(typeof sp.skip === 'string' ? sp.skip : 0) || 0, 0);

  const res = await listIntake(prisma, session, {
    page: Math.floor(skip / TAKE) + 1,
    pageSize: TAKE,
  });
  if (!res.ok) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Входящие в работу</h1>
        <p className="text-sm text-gray-500 mt-1">
          Всё неразобранное в одном месте: заявки, обращения и звонки. Самое залежавшееся — сверху.
        </p>
      </div>
      <IntakeTable items={res.result.items} viewerPrefix="/manager" currentUserId={session.sub} />
      <Paginator
        basePath="/manager/intake"
        searchParams={sp}
        take={TAKE}
        skip={skip}
        total={res.result.total}
      />
    </div>
  );
}
