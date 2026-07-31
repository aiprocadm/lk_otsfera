import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getFunnelBoard } from '@/lib/services/funnel/board';
import { FunnelBoard } from '@/components/funnel/funnel-board';

export const dynamic = 'force-dynamic';

export default async function ManagerFunnelPage() {
  if (!isFeatureEnabled('sales_funnel')) notFound();
  const session = await requireManager();
  const board = await getFunnelBoard(prisma, session);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Воронка продаж</h1>
        <p className="text-sm text-gray-500 mt-1">
          Перетаскивайте карточки между стадиями воронки.
        </p>
      </div>
      <FunnelBoard board={board} />
    </div>
  );
}
