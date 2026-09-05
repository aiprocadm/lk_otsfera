import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getDealBoard } from '@/lib/services/deals/board';
import { listCompanyOrgOptions } from '@/lib/services/manager/organizations';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { DealBoard } from '@/components/deals/deal-board';
import { DealStageConfig } from '@/components/deals/deal-stage-config';
import { DealsManagerFilter } from '@/components/deals/deals-manager-filter';
import { NewDealButton } from '@/components/deals/deal-dialog';

import { PageHeader } from '@/components/ui/page-header';
import { ListCapNotice } from '@/components/ui';
export const dynamic = 'force-dynamic';

/**
 * Этап 6 (PR-1) — доска сделок руководителя: company-floor скоуп + фильтр по
 * ответственному менеджеру (?manager=) + настройка стадий. Гейт: флаг
 * deals_pipeline (page-точка из трёх) + requireManagerLeader.
 */
export default async function LeaderDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ manager?: string }>;
}) {
  if (!isFeatureEnabled('deals_pipeline')) notFound();
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const managerId = sp.manager?.trim() || undefined;

  const [board, organizations, managers] = await Promise.all([
    // exactOptionalPropertyTypes: сервис различает «ключа нет» и «ключ = undefined».
    getDealBoard(prisma, session, { ...(managerId !== undefined ? { managerId } : {}) }),
    listCompanyOrgOptions(prisma, session),
    session.companyId ? listCompanyManagers(prisma, session.companyId) : Promise.resolve([]),
  ]);

  const managerOptions = managers
    .filter((m) => m.isActive)
    .map((m) => ({ id: m.id, name: m.name }));
  const isDefault = board.stages.length > 0 && board.stages[0]!.id.startsWith('default:');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <PageHeader
            title="Сделки"
            subtitle="Перетаскивайте карточки между стадиями. «Проиграна» требует причину, «Выиграна» завершает сделку."
          />
        </div>
        <NewDealButton
          organizations={organizations}
          managers={managerOptions}
          currentUserId={session.sub}
        />
      </div>
      <DealsManagerFilter managers={managerOptions} managerId={managerId} />
      <DealBoard
        board={board}
        organizations={organizations}
        managers={managerOptions}
        currentUserId={session.sub}
        tasksEnabled={isFeatureEnabled('internal_tasks')}
      />
      <ListCapNotice
        shown={board.shown}
        total={board.total}
        hint="Открытые сделки идут первыми и не теряются; за пределом — самые старые закрытые, их видно в карточке организации (вкладка «Сделки»)."
      />
      <DealStageConfig stages={board.stages} isDefault={isDefault} />
    </div>
  );
}
