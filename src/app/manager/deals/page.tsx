import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getDealBoard } from '@/lib/services/deals/board';
import { listCompanyOrgOptions } from '@/lib/services/manager/organizations';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { DealBoard } from '@/components/deals/deal-board';
import { NewDealButton } from '@/components/deals/deal-dialog';

import { PageHeader } from '@/components/ui/page-header';
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
    listCompanyOrgOptions(prisma, session),
    session.companyId ? listCompanyManagers(prisma, session.companyId) : Promise.resolve([]),
  ]);

  const managerOptions = managers
    .filter((m) => m.isActive)
    .map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <PageHeader
            title="Сделки"
            subtitle="Перетаскивайте карточки между стадиями. «Проиграна» требует причину."
          />
        </div>
        <NewDealButton
          organizations={organizations}
          managers={managerOptions}
          currentUserId={session.sub}
        />
      </div>
      <DealBoard
        board={board}
        organizations={organizations}
        managers={managerOptions}
        currentUserId={session.sub}
        tasksEnabled={isFeatureEnabled('internal_tasks')}
      />
    </div>
  );
}
