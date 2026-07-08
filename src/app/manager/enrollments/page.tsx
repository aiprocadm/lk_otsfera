import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { EnrollmentQueue } from '@/components/enrollment/enrollment-queue';
import { EnrollmentRequestForm } from '@/components/enrollment/enrollment-request-form';

export const dynamic = 'force-dynamic';

export default async function ManagerEnrollmentsPage() {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const session = await requireManager();
  const { rows } = await listEnrollmentRequests(prisma, session, {});
  return (
    <div className='space-y-5'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Заявки на обучение</h1>
      <EnrollmentQueue rows={rows} />
      <EnrollmentRequestForm />
    </div>
  );
}