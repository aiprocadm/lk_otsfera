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
import { getWelcomeViewer } from '@/lib/services/welcome/viewer';
import { WelcomeCard } from '@/components/welcome/welcome-card';
import { welcomeActionsFor } from '@/lib/welcomeActions';

export default async function OrganizationDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await getOrgPageContext(sp);

  const enrollmentsEnabled = isFeatureEnabled('enrollment_requests');
  const certificatesEnabled = isFeatureEnabled('certificates_registry');
  const [k, a, events, enrollments, expiringCerts, viewer] = await Promise.all([
    kpis(prisma, ctx.activeOrgId),
    attention(prisma, ctx.activeOrgId),
    recentEvents(prisma, ctx.activeOrgId),
    enrollmentsEnabled ? recentEnrollments(prisma, ctx.activeOrgId) : Promise.resolve([]),
    certificatesEnabled ? expiringCertificates(prisma, ctx.activeOrgId) : Promise.resolve(null),
    // ФТ-10.4: одноразовый welcome-блок — пока пользователь его не скрыл.
    getWelcomeViewer(prisma, ctx.session),
  ]);

  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#111111]">Главная</h1>
          <p className="text-sm text-gray-500 mt-1">Обзор по {ctx.activeOrgName}</p>
        </div>
        {viewer && viewer.welcomeSeenAt === null && (
          <WelcomeCard name={viewer.name} actions={welcomeActionsFor('organization')} />
        )}
        <OrgKpiGrid kpis={k} expiringCertificates={expiringCerts} />
        {enrollmentsEnabled && <OrgEnrollmentsCard rows={enrollments} />}
        <div className="grid gap-4 md:grid-cols-2">
          <OrgAttentionList data={a} />
          <OrgEventsFeed events={events} />
        </div>
      </div>
    </OrgAppShell>
  );
}
