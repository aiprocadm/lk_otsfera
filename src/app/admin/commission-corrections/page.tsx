import React from 'react';
import { requireAdmin } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listCorrectionQueue } from '@/lib/services/commission/corrections';
import { CorrectionsQueueTable } from '@/components/commission/corrections-queue-table';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function AdminCommissionCorrectionsPage() {
  const session = await requireAdmin();
  const rows = await listCorrectionQueue(prisma, session);
  const serialized = rows.map((r) => ({
    id: r.id,
    partnerName: r.partner?.name ?? '—',
    amount: r.amount.toString(),
    commissionAmount: r.commissionAmount.toString(),
    rate: r.rate.toString(),
    originalPeriodFrom: r.originalPeriodFrom.toISOString(),
    originalPeriodTo: r.originalPeriodTo.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Корректировки комиссии"
          subtitle="Поздние возвраты в закрытые периоды — требуют решения (§9.5)."
        />
      </div>
      <CorrectionsQueueTable rows={serialized} />
    </div>
  );
}
