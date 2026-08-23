import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrgsList } from '@/components/manager/manager-orgs-list';

export const dynamic = 'force-dynamic';

export default async function LeaderOrganizationsPage() {
  const session = await requireManagerLeader();
  const orgs = await listOrganizations(prisma, session, true);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-[#111111]">Организации</h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">Клиенты компании и менеджеры, которые их ведут</p>
      {/* `У-101`: руководитель открывает карточку в своём кабинете. */}
      <ManagerOrgsList orgs={orgs} basePath="/leader/organizations" />
    </div>
  );
}
