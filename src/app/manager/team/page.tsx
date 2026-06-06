import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { listCompanyManagers } from '@/lib/services/manager/team';
import { TeamVisibilityToggle } from '@/components/manager/team-visibility-toggle';
import { ManagerRosterPanel } from '@/components/manager/manager-roster-panel';

export default async function ManagerTeamPage() {
  const session = await requireManagerLeader();
  const teamMode = session.companyId
    ? await getCompanyTeamVisibility(prisma, session.companyId)
    : false;
  const roster = session.companyId
    ? await listCompanyManagers(prisma, session.companyId)
    : [];

  return (
    <div className='space-y-6'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Команда</h1>
      <TeamVisibilityToggle initial={teamMode} />
      <ManagerRosterPanel roster={roster} />
    </div>
  );
}
