import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requirePartnerAdmin } from '@/lib/auth/requireRole';
import { listTeam } from '@/lib/services/partner/team';
import { listPartnerOrgOptions } from '@/lib/services/partner/orgOptions';
import { TeamTable } from '@/components/partner/team-table';
import { TeamCardList } from '@/components/partner/team-card-list';
import { InviteMemberForm } from '@/components/partner/invite-member-form';
import { pluralizeRu } from '@/lib/format';

export default async function PartnerTeamPage() {
  const session = await requirePartnerAdmin();

  const [rows, orgs] = await Promise.all([
    listTeam(prisma, session.partnerId),
    listPartnerOrgOptions(prisma, { partnerId: session.partnerId }),
  ]);

  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#111111]">Команда</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeCount}{' '}
            {pluralizeRu(
              activeCount,
              'активный сотрудник',
              'активных сотрудника',
              'активных сотрудников'
            )}
            {rows.length > activeCount && (
              <span className="text-gray-400">
                {' '}
                · {rows.length - activeCount} деактивирован
                {rows.length - activeCount === 1 ? '' : 'о'}
              </span>
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
