import React from 'react';
import { prisma } from '@/lib/db/prisma';
import { requirePartner } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import {
  kpis,
  attention,
  recentEvents,
  recentEnrollments,
  expiringCertificates,
} from '@/lib/services/partner/dashboard';
import { KpiGrid } from '@/components/partner/kpi-grid';
import { AttentionList } from '@/components/partner/attention-list';
import { EventsFeed } from '@/components/partner/events-feed';
import { PartnerEnrollmentsCard } from '@/components/partner/partner-enrollments-card';
import { QuickTasks } from '@/components/dashboard/quick-tasks';
import { YourManagerCard } from '@/components/dashboard/your-manager-card';
import { getPartnerYourManager } from '@/lib/services/partner/yourManager';
import { getPartnerFirstSteps } from '@/lib/services/partner/firstSteps';
import { FirstStepsCard } from '@/components/dashboard/first-steps-card';
import { dismissPartnerFirstStepsAction } from '@/server-actions/partner/firstSteps';
import { quickTasksFor } from '@/lib/quickTasks';

import { PageHeader } from '@/components/ui/page-header';
export default async function PartnerDashboard() {
  const session = await requirePartner();

  const scope = {
    partnerId: session.partnerId,
    scopeOrgIds: session.assignedOrgIds ?? [],
  };

  const enrollmentsEnabled = isFeatureEnabled('enrollment_requests');
  const certificatesEnabled = isFeatureEnabled('certificates_registry');
  const [k, a, events, enrollments, expiringCerts, yourManager, firstSteps] = await Promise.all([
    kpis(prisma, scope),
    attention(prisma, scope),
    recentEvents(prisma, scope, 10),
    enrollmentsEnabled ? recentEnrollments(prisma, scope) : Promise.resolve([]),
    certificatesEnabled ? expiringCertificates(prisma, scope) : Promise.resolve(null),
    // Этап 6 (`У-240`): ответственный за партнёра, иначе менеджер первой организации.
    getPartnerYourManager(prisma, scope.partnerId),
    // Этап 6 (`У-239`): чек-лист по данным; «Команда» — только администратору партнёра.
    getPartnerFirstSteps(prisma, {
      partnerId: scope.partnerId,
      userId: session.sub,
      isPartnerAdmin: session.partnerRole === 'admin',
    }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="Главная" subtitle="Обзор ключевых показателей и активности" />
      </div>

      {/* `У-71`: блок постоянный — он отвечает на вопрос «что делать»,
          а не «как дела». Одноразовый welcome-блок заменён им. */}
      <FirstStepsCard
        view={firstSteps}
        dismissAction={dismissPartnerFirstStepsAction}
        scopeField={{ name: 'partnerId', value: scope.partnerId }}
      />
      <QuickTasks tasks={quickTasksFor('partner')} />
      <YourManagerCard view={yourManager} writeHref="/partner/messages?tab=manager" />

      <KpiGrid kpis={k} expiringCertificates={expiringCerts} />

      {enrollmentsEnabled && <PartnerEnrollmentsCard rows={enrollments} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AttentionList data={a} />
        <EventsFeed events={events} />
      </div>
    </div>
  );
}
