import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { TeamVisibilityToggle } from '@/components/manager/team-visibility-toggle';
import { ManagerRosterPanel } from '@/components/manager/manager-roster-panel';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function LeaderTeamPage() {
  const session = await requireManagerLeader();
  const teamMode = session.companyId
    ? await getCompanyTeamVisibility(prisma, session.companyId)
    : false;
  const roster = session.companyId ? await listCompanyManagers(prisma, session.companyId) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Команда"
        subtitle="Менеджеры команды: нагрузка, планы продаж и видимость заказов"
      />
      <TeamVisibilityToggle initial={teamMode} />
      {/* `У-130`: пороги SLA уехали в «Настройки → Конфигурация процессов →
          SLA входящих в работу». Здесь им было не место: это настройка
          процесса, а не раздел про людей. */}
      <ManagerRosterPanel roster={roster} />
    </div>
  );
}
