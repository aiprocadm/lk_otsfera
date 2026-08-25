import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrgsList } from '@/components/manager/manager-orgs-list';

import { PageHeader } from '@/components/ui/page-header';
export default async function ManagerOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  // `У-94`: отбор «без ИНН» живёт в адресе — ссылкой на него можно поделиться.
  const withoutInn = sp.inn === 'without';
  const session = await requireManager();
  const orgs = await listOrganizations(prisma, session, undefined, { withoutInn });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Организации"
        subtitle="Ваши клиенты: в карточке собрана вся история работы"
      />
      <ManagerOrgsList orgs={orgs} withoutInn={withoutInn} />
    </div>
  );
}
