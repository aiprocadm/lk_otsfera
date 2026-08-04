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
import { getWelcomeViewer } from '@/lib/services/welcome/viewer';
import { KpiGrid } from '@/components/partner/kpi-grid';
import { AttentionList } from '@/components/partner/attention-list';
import { EventsFeed } from '@/components/partner/events-feed';
import { PartnerEnrollmentsCard } from '@/components/partner/partner-enrollments-card';
import { WelcomeCard } from '@/components/welcome/welcome-card';
import { welcomeActionsFor } from '@/lib/welcomeActions';

export default async function PartnerDashboard() {
  const session = await requirePartner();

  const scope = {
    partnerId: session.partnerId,
    scopeOrgIds: session.assignedOrgIds ?? [],
  };

  const enrollmentsEnabled = isFeatureEnabled('enrollment_requests');
  const certificatesEnabled = isFeatureEnabled('certificates_registry');
  const [k, a, events, enrollments, expiringCerts, viewer] = await Promise.all([
    kpis(prisma, scope),
    attention(prisma, scope),
    recentEvents(prisma, scope, 10),
    enrollmentsEnabled ? recentEnrollments(prisma, scope) : Promise.resolve([]),
    certificatesEnabled ? expiringCertificates(prisma, scope) : Promise.resolve(null),
    // ФТ-10.4: одноразовый welcome-блок — пока пользователь его не скрыл.
    getWelcomeViewer(prisma, session),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Кабинет партнёра</h1>
        <p className="text-sm text-gray-500 mt-0.5">Обзор ключевых показателей и активности</p>
      </div>

      {viewer && viewer.welcomeSeenAt === null && (
        <WelcomeCard name={viewer.name} actions={welcomeActionsFor('partner')} />
      )}

      <KpiGrid kpis={k} expiringCertificates={expiringCerts} />

      {enrollmentsEnabled && <PartnerEnrollmentsCard rows={enrollments} />}

      <div className="grid gap-4 md:grid-cols-2">
        <AttentionList data={a} />
        <EventsFeed events={events} />
      </div>
    </div>
  );
}
