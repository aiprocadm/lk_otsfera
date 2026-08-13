import React from 'react';
import { notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { listPartnerOrgOptions } from '@/lib/services/partner/orgOptions';
import { listDirectionOptions } from '@/lib/services/training/directions';
import { EnrollmentWizard } from '@/components/enrollment/enrollment-wizard';
import { EnrollmentList } from '@/components/enrollment/enrollment-list';

export const dynamic = 'force-dynamic';

export default async function PartnerEnrollmentsPage() {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const session = await requirePartner();
  const [{ rows }, orgs, directions] = await Promise.all([
    listEnrollmentRequests(prisma, session, {}),
    listPartnerOrgOptions(prisma, { partnerId: session.partnerId }),
    listDirectionOptions(prisma),
  ]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-[#111111]">Заявки на обучение</h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">
        Списки сотрудников на обучение по вашим клиентам
      </p>
      <EnrollmentWizard directions={directions} organizations={orgs} />
      <EnrollmentList rows={rows} detailHrefBase="/partner/enrollments" />
    </div>
  );
}
