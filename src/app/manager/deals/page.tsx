import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getDealBoard } from '@/lib/services/deals/board';
import { listCompanyOrgOptions } from '@/lib/services/manager/organizations';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { listContactOptions } from '@/lib/services/contacts/options';
import { DealBoard } from '@/components/deals/deal-board';
import { NewDealButton } from '@/components/deals/deal-dialog';

import { PageHeader } from '@/components/ui/page-header';
import { ListCapNotice } from '@/components/ui';
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

  // Этап 1 ТЗ 12.09.2026 (`У-180`): поле «Контакт» формы сделки — контакты в
  // охвате сотрудника (`teamMode` свежий, C8); при выключенном флаге поля нет.
  const contacts = isFeatureEnabled('contacts')
    ? await listContactOptions(
        prisma,
        session,
        await getCompanyTeamVisibility(prisma, session.companyId)
      )
    : undefined;

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
          contacts={contacts}
          currentUserId={session.sub}
        />
      </div>
      <DealBoard
        board={board}
        organizations={organizations}
        managers={managerOptions}
        contacts={contacts}
        contactHrefBase="/manager/contacts"
        currentUserId={session.sub}
        tasksEnabled={isFeatureEnabled('internal_tasks')}
      />
      <ListCapNotice
        shown={board.shown}
        total={board.total}
        hint="Открытые сделки идут первыми и не теряются; за пределом — самые старые закрытые, их видно в карточке организации (вкладка «Сделки»)."
      />
    </div>
  );
}
