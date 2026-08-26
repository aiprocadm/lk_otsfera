import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgKpiGrid } from '@/components/organization/org-kpi-grid';
import { OrgAttentionList } from '@/components/organization/org-attention-list';
import { OrgEventsFeed } from '@/components/organization/org-events-feed';
import { OrgEnrollmentsCard } from '@/components/organization/org-enrollments-card';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  kpis,
  attention,
  recentEvents,
  recentEnrollments,
  expiringCertificates,
} from '@/lib/services/organization/dashboard';
import { QuickTasks } from '@/components/dashboard/quick-tasks';
import { quickTasksFor } from '@/lib/quickTasks';

import { PageHeader } from '@/components/ui/page-header';
export default async function OrganizationDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  const enrollmentsEnabled = isFeatureEnabled('enrollment_requests');
  const certificatesEnabled = isFeatureEnabled('certificates_registry');
  const [k, a, events, enrollments, expiringCerts] = await Promise.all([
    kpis(prisma, ctx.activeOrgId),
    attention(prisma, ctx.activeOrgId),
    recentEvents(prisma, ctx.activeOrgId),
    enrollmentsEnabled ? recentEnrollments(prisma, ctx.activeOrgId) : Promise.resolve([]),
    certificatesEnabled ? expiringCertificates(prisma, ctx.activeOrgId) : Promise.resolve(null),
    // ФТ-10.4: одноразовый welcome-блок — пока пользователь его не скрыл.
  ]);

  return (
    <OrgAppShell
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-6">
        <div>
          <PageHeader title="Главная" subtitle={<>Обзор по {ctx.activeOrgName}</>} />
        </div>
        {/* `У-71`: постоянный блок вместо одноразового welcome-блока. */}
        <QuickTasks tasks={quickTasksFor('organization')} />
        <OrgKpiGrid kpis={k} expiringCertificates={expiringCerts} />
        {enrollmentsEnabled && <OrgEnrollmentsCard rows={enrollments} />}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <OrgAttentionList data={a} />
          <OrgEventsFeed events={events} />
        </div>
      </div>
    </OrgAppShell>
  );
}
