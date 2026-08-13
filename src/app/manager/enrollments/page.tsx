import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { listDirectionOptions } from '@/lib/services/training/directions';
import { EnrollmentQueue } from '@/components/enrollment/enrollment-queue';
import { EnrollmentWizard } from '@/components/enrollment/enrollment-wizard';

export const dynamic = 'force-dynamic';

export default async function ManagerEnrollmentsPage() {
  if (!isFeatureEnabled('enrollment_requests')) notFound();
  const session = await requireManager();
  const [{ rows }, directions] = await Promise.all([
    listEnrollmentRequests(prisma, session, {}),
    listDirectionOptions(prisma),
  ]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-[#111111]">Заявки на обучение</h1>
      {/* `У-73`: одна строка «что здесь делают». */}
      <p className="text-sm text-gray-500 mt-0.5">Списки сотрудников, которых нужно обучить</p>
      <EnrollmentQueue rows={rows} />
      <EnrollmentWizard directions={directions} />
    </div>
  );
}
