import { prisma } from '@/lib/db/prisma';
import { requirePartnerAdmin } from '@/lib/auth/requireRole';
import { listTeam } from '@/lib/services/partner/team';
import { TeamTable } from '@/components/partner/team-table';
import { TeamCardList } from '@/components/partner/team-card-list';
import { InviteMemberForm } from '@/components/partner/invite-member-form';

export default async function PartnerTeamPage() {
  const session = await requirePartnerAdmin();

  const [rows, orgs] = await Promise.all([
    listTeam(prisma, session.partnerId),
    prisma.organization.findMany({
      where: { partnerId: session.partnerId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true }
    })
  ]);

  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <div className='space-y-4'>
      <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-[#111111]'>Команда</h1>
          <p className='text-sm text-gray-500 mt-0.5'>
            {activeCount} {pluralize(activeCount, 'активный сотрудник', 'активных сотрудника', 'активных сотрудников')}
            {rows.length > activeCount && (
              <span className='text-gray-400'> · {rows.length - activeCount} деактивирован{rows.length - activeCount === 1 ? '' : 'о'}</span>
            )}
          </p>
        </div>
        <InviteMemberForm orgs={orgs} />
      </div>

      <TeamTable rows={rows} orgs={orgs} currentUserId={session.sub} />
      <TeamCardList rows={rows} orgs={orgs} currentUserId={session.sub} />
    </div>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
