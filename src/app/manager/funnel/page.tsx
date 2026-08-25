import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getFunnelBoard } from '@/lib/services/funnel/board';
import { FunnelBoard } from '@/components/funnel/funnel-board';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function ManagerFunnelPage() {
  if (!isFeatureEnabled('sales_funnel')) notFound();
  const session = await requireManager();
  const board = await getFunnelBoard(prisma, session);

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Воронка продаж"
          subtitle="Перетаскивайте карточки между стадиями воронки."
        />
      </div>
      <FunnelBoard board={board} />
    </div>
  );
}
