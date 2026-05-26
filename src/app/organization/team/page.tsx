import { prisma } from '@/lib/db/prisma';
import { redirect } from 'next/navigation';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { TeamTable } from '@/components/organization/team-table';
import { InviteOrgUserForm } from '@/components/organization/invite-org-user-form';
import { listMembers } from '@/lib/services/organization/team';

type SearchParams = {
  org?: string;
};

export default async function OrganizationTeamPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  // Members area is admin-only — non-admins shouldn't reach this page via
  // direct URL. requireOrganization in layout permits members, so we gate
  // here at the page level. (Sidebar already hides the link from members.)
  if (ctx.viewerRole !== 'admin') {
    redirect('/forbidden');
  }

  const members = await listMembers(prisma, ctx.activeOrgId);
  const activeAdminCount = members.filter(
    (m) => m.isActive && m.roleInOrg === 'admin'
  ).length;

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className='space-y-4'>
        <div className='flex flex-col md:flex-row md:items-center md:justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold text-[#111111]'>Команда</h1>
            <p className='text-sm text-gray-500 mt-0.5'>
              {members.length} {pluralizeMembers(members.length)} в «{ctx.activeOrgName}»
              {activeAdminCount > 0 && (
                <span className='text-gray-400'>
                  {' '}
                  · {activeAdminCount} {pluralizeAdmins(activeAdminCount)}
                </span>
              )}
            </p>
          </div>
          <InviteOrgUserForm organizationId={ctx.activeOrgId} />
        </div>

        <TeamTable
          members={members}
          organizationId={ctx.activeOrgId}
          currentUserId={ctx.session.sub}
        />

        <p className='text-xs text-gray-400 mt-2'>
          Администраторы могут приглашать новых участников, менять роли и
          деактивировать доступ. Последнего активного администратора деактивировать
          нельзя.
        </p>
      </div>
    </OrgAppShell>
  );
}

function pluralizeMembers(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'участник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'участника';
  return 'участников';
}

function pluralizeAdmins(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'администратор';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'администратора';
  return 'администраторов';
}
