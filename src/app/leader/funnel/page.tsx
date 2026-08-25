import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getFunnelBoard } from '@/lib/services/funnel/board';
import { FunnelBoard } from '@/components/funnel/funnel-board';
import { StageConfig } from '@/components/funnel/stage-config';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function LeaderFunnelPage() {
  if (!isFeatureEnabled('sales_funnel')) notFound();
  const session = await requireManagerLeader();
  const board = await getFunnelBoard(prisma, session);
  const isDefault = board.stages.length > 0 && board.stages[0]!.id.startsWith('default:');

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          title="Воронка продаж"
          subtitle="Перетаскивайте карточки между стадиями. «Передано в работу» создаёт заказ, «Отказ» требует причину."
        />
      </div>
      <FunnelBoard board={board} />
      <StageConfig stages={board.stages} isDefault={isDefault} />
    </div>
  );
}
