import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrgsList } from '@/components/manager/manager-orgs-list';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function LeaderOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const withoutInn = sp.inn === 'without';
  const session = await requireManagerLeader();
  const orgs = await listOrganizations(prisma, session, true, { withoutInn });
  return (
    <div className="space-y-4">
      <PageHeader title="Организации" subtitle="Клиенты компании и менеджеры, которые их ведут" />
      {/* `У-101`: руководитель открывает карточку в своём кабинете. */}
      <ManagerOrgsList orgs={orgs} basePath="/leader/organizations" withoutInn={withoutInn} />
    </div>
  );
}
