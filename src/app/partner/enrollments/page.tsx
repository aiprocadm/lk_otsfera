import React from 'react';
import { notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { EnrollmentRequestForm } from '@/components/enrollment/enrollment-request-form';
import { EnrollmentList } from '@/components/enrollment/enrollment-list';

export const dynamic = 'force-dynamic';

export default async function PartnerEnrollmentsPage() {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const session = await requirePartner();
  const [{ rows }, orgs] = await Promise.all([
    listEnrollmentRequests(prisma, session, {}),
    prisma.organization.findMany({ where: { partnerId: session.partnerId }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
  ]);
  return (
    <div className='space-y-5'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Заявки на обучение</h1>
      <EnrollmentRequestForm organizations={orgs} />
      <EnrollmentList rows={rows} />
    </div>
  );
}
