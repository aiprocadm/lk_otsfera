import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { TeamVisibilityToggle } from '@/components/manager/team-visibility-toggle';
import { LeaderTeamBoard } from '@/components/leader/leader-team-board';
import { getLeaderTeamBoard } from '@/lib/services/leader/teamBoard';
import { LeaderManagersTable } from '@/components/leader/leader-managers-table';
import { leaderDashboard } from '@/lib/services/leader/dashboard';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function LeaderTeamPage() {
  const session = await requireManagerLeader();
  const teamMode = session.companyId
    ? await getCompanyTeamVisibility(prisma, session.companyId)
    : false;
  const [board, results] = await Promise.all([
    // `У-346` (макет 2): организации менеджеров со статистикой, перевод и назначение.
    getLeaderTeamBoard(prisma, session),
    // `У-346`: таблица «Менеджеры команды» переехала с главной — результаты
    // команды смотрят здесь, а главная ведёт сюда кнопкой.
    leaderDashboard(prisma, session),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Команда"
        subtitle="Результаты менеджеров, их организации и назначение ответственных"
      />
      <section className="space-y-2">
        <div>
          <h2 className="text-lg font-semibold text-[#111111]">Менеджеры команды</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Суммы — по заказам в работе у каждого менеджера; не сводятся с «Долгом клиентов» (он
            считается по выставленным к оплате заказам компании).
          </p>
        </div>
        <LeaderManagersTable rows={results.perManager} />
      </section>
      <TeamVisibilityToggle initial={teamMode} />
      {/* `У-130`: пороги SLA уехали в «Настройки → Конфигурация процессов →
          SLA входящих в работу». Здесь им было не место: это настройка
          процесса, а не раздел про людей. */}
      <LeaderTeamBoard board={board} />
    </div>
  );
}
