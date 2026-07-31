import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { EnrollmentWizard } from '@/components/enrollment/enrollment-wizard';
import { EnrollmentList } from '@/components/enrollment/enrollment-list';

export const dynamic = 'force-dynamic';

export default async function OrganizationEnrollmentsPage() {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const ctx = await getOrgPageContext({});
  const [{ rows }, directions] = await Promise.all([
    listEnrollmentRequests(prisma, ctx.session, {}),
    prisma.trainingDirection.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
  ]);
  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold text-[#111111]">Заявки на обучение</h1>
        <EnrollmentWizard directions={directions} defaultOrganizationId={ctx.activeOrgId} />
        <EnrollmentList rows={rows} detailHrefBase="/organization/enrollments" />
      </div>
    </OrgAppShell>
  );
}
