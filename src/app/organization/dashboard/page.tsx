import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { OrgKpiGrid } from '@/components/organization/org-kpi-grid';
import { OrgAttentionList } from '@/components/organization/org-attention-list';
import { OrgEventsFeed } from '@/components/organization/org-events-feed';
import { OrgEnrollmentsCard } from '@/components/organization/org-enrollments-card';
import {
  kpis,
  attention,
  recentEvents,
  recentEnrollments,
  expiringCertificates,
} from '@/lib/services/organization/dashboard';
import { QuickTasks } from '@/components/dashboard/quick-tasks';
import { YourManagerCard } from '@/components/dashboard/your-manager-card';
import { getOrgYourManager } from '@/lib/services/organization/yourManager';
import { getOrgFirstSteps } from '@/lib/services/organization/firstSteps';
import { orgOrderScope } from '@/lib/services/organization/memberScope';
import { FirstStepsCard } from '@/components/dashboard/first-steps-card';
import { dismissOrgFirstStepsAction } from '@/server-actions/organization/firstSteps';
import { quickTasksFor } from '@/lib/quickTasks';

import { PageHeader } from '@/components/ui/page-header';
export default async function OrganizationDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  // `У-236`: заказы главной — в границе участника (счётчики, «Требует внимания», лента).
  const scope = await orgOrderScope(prisma, ctx.session, ctx.activeOrgId);
  const [k, a, events, enrollments, expiringCerts, yourManager, firstSteps] = await Promise.all([
    kpis(prisma, ctx.activeOrgId, scope),
    attention(prisma, ctx.activeOrgId, scope),
    recentEvents(prisma, ctx.activeOrgId, undefined, scope),
    recentEnrollments(prisma, ctx.activeOrgId),
    expiringCertificates(prisma, ctx.activeOrgId),
    // Этап 6 (`У-240`): кто ведёт заказы организации.
    getOrgYourManager(prisma, ctx.activeOrgId),
    // Этап 6 (`У-239`): чек-лист по данным, «Закрыть» — на членстве.
    getOrgFirstSteps(prisma, { organizationId: ctx.activeOrgId, userId: ctx.session.sub }),
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
        <FirstStepsCard
          view={firstSteps}
          dismissAction={dismissOrgFirstStepsAction}
          scopeField={{ name: 'organizationId', value: ctx.activeOrgId }}
        />
        {/* `У-71`: постоянный блок вместо одноразового welcome-блока. */}
        <QuickTasks tasks={quickTasksFor('organization')} />
        <YourManagerCard view={yourManager} writeHref="/organization/messages?tab=manager" />
        <OrgKpiGrid kpis={k} expiringCertificates={expiringCerts} />
        <OrgEnrollmentsCard rows={enrollments} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <OrgAttentionList data={a} />
          <OrgEventsFeed events={events} />
        </div>
      </div>
    </OrgAppShell>
  );
}
