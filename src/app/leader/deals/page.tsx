import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getDealBoard } from '@/lib/services/deals/board';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { DealBoard } from '@/components/deals/deal-board';
import { DealStageConfig } from '@/components/deals/deal-stage-config';
import { DealsManagerFilter } from '@/components/deals/deals-manager-filter';
import { NewDealButton } from '@/components/deals/deal-dialog';

export const dynamic = 'force-dynamic';

/**
 * Этап 6 (PR-1) — доска сделок руководителя: company-floor скоуп + фильтр по
 * ответственному менеджеру (?manager=) + настройка стадий. Гейт: флаг
 * deals_pipeline (page-точка из трёх) + requireManagerLeader.
 */
export default async function LeaderDealsPage({
  searchParams
}: {
  searchParams: Promise<{ manager?: string }>;
}) {
  if (!isFeatureEnabled('deals_pipeline')) notFound();
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const managerId = sp.manager?.trim() || undefined;

  const [board, organizations, managers] = await Promise.all([
    getDealBoard(prisma, session, { managerId }),
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
  const isDefault = board.stages.length > 0 && board.stages[0]!.id.startsWith('default:');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#111111]">Сделки</h1>
          <p className="text-sm text-gray-500 mt-1">
            Перетаскивайте карточки между стадиями. «Проиграна» требует причину, «Выиграна» завершает сделку.
          </p>
        </div>
        <NewDealButton organizations={organizations} managers={managerOptions} currentUserId={session.sub} />
      </div>
      <DealsManagerFilter managers={managerOptions} managerId={managerId} />
      <DealBoard board={board} organizations={organizations} managers={managerOptions} currentUserId={session.sub} />
      <DealStageConfig stages={board.stages} isDefault={isDefault} />
    </div>
  );
}
