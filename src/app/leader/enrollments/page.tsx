import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { EnrollmentQueue } from '@/components/enrollment/enrollment-queue';

export const dynamic = 'force-dynamic';

export default async function LeaderEnrollmentsPage() {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const session = await requireManagerLeader();
  const { rows } = await listEnrollmentRequests(prisma, session, {});
  return (
    <div className='space-y-5'>
      <h1 className='text-2xl font-semibold text-[#111111]'>Заявки на обучение</h1>
      <EnrollmentQueue rows={rows} />
    </div>
  );
}
