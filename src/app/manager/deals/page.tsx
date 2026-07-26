import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getDealBoard } from '@/lib/services/deals/board';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { DealBoard } from '@/components/deals/deal-board';
import { NewDealButton } from '@/components/deals/deal-dialog';

export const dynamic = 'force-dynamic';

/**
 * Этап 6 (PR-1) — доска сделок менеджера (свои сделки, PR-1-скоуп own).
 * Гейт: флаг deals_pipeline (page-точка из трёх) + requireManager.
 */
export default async function ManagerDealsPage() {
  if (!isFeatureEnabled('deals_pipeline')) notFound();
  const session = await requireManager();

  const [board, organizations, managers] = await Promise.all([
    getDealBoard(prisma, session),
    session.companyId
      ? prisma.organization.findMany({
          where: { companyId: session.companyId },
          select: { id: true, name: true },
          orderBy: { name: 'asc' }
        })
      : Promise.resolve([]),
    session.companyId ? listCompanyManagers(prisma, session.companyId) : Promise.resolve([])
  ]);

  const managerOptions = managers.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#111111]">Сделки</h1>
          <p className="text-sm text-gray-500 mt-1">
            Перетаскивайте карточки между стадиями. «Проиграна» требует причину.
          </p>
        </div>
        <NewDealButton organizations={organizations} managers={managerOptions} currentUserId={session.sub} />
      </div>
      <DealBoard board={board} organizations={organizations} managers={managerOptions} currentUserId={session.sub} tasksEnabled={isFeatureEnabled('internal_tasks')} />
    </div>
  );
}
