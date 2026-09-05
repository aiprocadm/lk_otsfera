import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listCorrectionQueue } from '@/lib/services/commission/corrections';
import { CorrectionsQueueTable } from '@/components/commission/corrections-queue-table';

import { PageHeader } from '@/components/ui/page-header';
import { ListCapNotice } from '@/components/ui';
export const dynamic = 'force-dynamic';

export default async function LeaderCommissionCorrectionsPage() {
  const session = await requireManagerLeader();
  const { rows, total } = await listCorrectionQueue(prisma, session);
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
      {/* `С-6`: очередь режется по 200; фильтра нет — остальные появятся после разбора. */}
      <ListCapNotice
        shown={serialized.length}
        total={total}
        hint="Разберите эти — появятся следующие."
      />
    </div>
  );
}
