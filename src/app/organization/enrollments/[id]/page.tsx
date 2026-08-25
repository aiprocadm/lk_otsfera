import React from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getOrgPageContext } from '@/lib/auth/orgPageContext';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getEnrollmentRequest } from '@/lib/services/enrollments/detail';
import { OrgAppShell } from '@/components/organization/org-app-shell';
import {
  EnrollmentDetailView,
  enrollmentTitle,
} from '@/components/enrollment/enrollment-detail-view';
import { buildCabinetBreadcrumbs } from '@/lib/navigation/breadcrumbs';

export const dynamic = 'force-dynamic';

/** Деталка заявки на обучение подателя-организации (этап 2 PR-2, ФТ-2.3). */
export default async function OrganizationEnrollmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const ctx = await getOrgPageContext({});
  const { id } = await params;
  // canSee-чек (§4): getEnrollmentRequest скоупит по сессии — чужая заявка = not_found.
  const r = await getEnrollmentRequest(prisma, ctx.session, id);
  if (!r.ok) notFound();
  return (
    <OrgAppShell
      userEmail={ctx.session.email}
      activeOrgName={ctx.activeOrgName}
      memberships={ctx.memberships}
      activeOrgId={ctx.activeOrgId}
      viewerRole={ctx.viewerRole}
    >
      <EnrollmentDetailView
        detail={r.request}
        backHref="/organization/enrollments"
        breadcrumbs={buildCabinetBreadcrumbs('organization', '/organization/enrollments', [
          { label: enrollmentTitle(r.request) },
        ])}
      />
    </OrgAppShell>
  );
}
