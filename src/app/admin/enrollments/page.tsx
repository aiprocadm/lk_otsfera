import React from 'react';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { listDirectionOptions } from '@/lib/services/training/directions';
import { EnrollmentQueue } from '@/components/enrollment/enrollment-queue';
import { EnrollmentWizard } from '@/components/enrollment/enrollment-wizard';

export const dynamic = 'force-dynamic';

export default async function AdminEnrollmentsPage() {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const session = await requireAdmin();
  const [{ rows }, directions] = await Promise.all([
    listEnrollmentRequests(prisma, session, {}),
    listDirectionOptions(prisma),
  ]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-[#111111]">Заявки на обучение</h1>
      <EnrollmentQueue rows={rows} />
      <EnrollmentWizard directions={directions} />
    </div>
  );
}
