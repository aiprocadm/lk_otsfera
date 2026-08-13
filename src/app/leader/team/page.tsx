import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { TeamVisibilityToggle } from '@/components/manager/team-visibility-toggle';
import { SlaSettingsCard } from '@/components/manager/sla-settings-card';
import { getSlaSettings } from '@/lib/services/manager/slaSettings';
import { ManagerRosterPanel } from '@/components/manager/manager-roster-panel';

export const dynamic = 'force-dynamic';

export default async function LeaderTeamPage() {
  const session = await requireManagerLeader();
  const teamMode = session.companyId
    ? await getCompanyTeamVisibility(prisma, session.companyId)
    : false;
  const roster = session.companyId ? await listCompanyManagers(prisma, session.companyId) : [];
  // Этап 7 (PR-3): пороги SLA входящих — карточка рядом с видимостью команды.
  const sla = session.companyId ? await getSlaSettings(prisma, session.companyId) : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[#111111]">Команда</h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">
        Менеджеры команды: нагрузка, планы продаж и видимость заказов
      </p>
      <TeamVisibilityToggle initial={teamMode} />
      {sla && <SlaSettingsCard initial={sla} />}
      <ManagerRosterPanel roster={roster} />
    </div>
  );
}
