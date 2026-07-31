import React from 'react';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { listCorrectionQueue } from '@/lib/services/commission/corrections';
import { CorrectionsQueueTable } from '@/components/commission/corrections-queue-table';

export const dynamic = 'force-dynamic';

export default async function LeaderCommissionCorrectionsPage() {
  const session = await requireManagerLeader();
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
        <h1 className="text-2xl font-semibold text-[#111111]">Корректировки комиссии</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Поздние возвраты в закрытые периоды — требуют решения (§9.5).
        </p>
      </div>
      <CorrectionsQueueTable rows={serialized} />
    </div>
  );
}
