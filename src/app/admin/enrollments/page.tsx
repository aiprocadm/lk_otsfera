import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { listDirectionOptions } from '@/lib/services/training/directions';
import { EnrollmentQueue } from '@/components/enrollment/enrollment-queue';
import { EnrollmentWizard } from '@/components/enrollment/enrollment-wizard';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function AdminEnrollmentsPage() {
  const session = await requireAdmin();
  const [{ rows }, directions] = await Promise.all([
    listEnrollmentRequests(prisma, session, {}),
    listDirectionOptions(prisma),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="Заявки на обучение" subtitle="Заявки на обучение от всех клиентов" />
      <EnrollmentQueue rows={rows} cardHrefBase="/admin/enrollments" />
      <EnrollmentWizard directions={directions} />
    </div>
  );
}
