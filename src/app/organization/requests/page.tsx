import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listClientRequests } from '@/lib/services/clientRequests/list';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import { ClientRequestForm } from '@/components/client-requests/client-request-form';
import { ClientRequestList } from '@/components/client-requests/client-request-list';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

/** Обращения организации — вопросы в поддержку (этап 5, ФТ-1.2/1.3): форма подачи + свои обращения. */
export default async function OrganizationRequestsPage() {
  if (!isFeatureEnabled('client_requests')) notFound();
  const ctx = await getOrgPageContext({});
  const { rows } = await listClientRequests(prisma, ctx.session, {});
  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <div className="space-y-5">
        <div>
          <PageHeader
            title="Обращения"
            subtitle="Обращения в поддержку: вопрос, запрос расчёта или новая потребность. Заявки на обучение слушателей подаются в разделе «Заявки на обучение»."
          />
        </div>
        <ClientRequestForm />
        <ClientRequestList rows={rows} detailHrefBase="/organization/requests" />
      </div>
    </OrgAppShell>
  );
}
