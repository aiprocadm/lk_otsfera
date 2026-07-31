import React from 'react';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { ManagerOrgsList } from '@/components/manager/manager-orgs-list';

export default async function ManagerOrganizationsPage() {
  const session = await requireManager();
  const orgs = await listOrganizations(prisma, session);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-[#111111]">Организации</h1>
      <ManagerOrgsList orgs={orgs} />
    </div>
  );
}
