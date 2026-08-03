import React from 'react';
import type { PrismaClient } from '@prisma/client';
import { fmtDateTime } from '@/lib/format';
import { listOrgHistory } from '@/lib/services/partner/orgHistory';

const labels: Record<string, string> = {
  partner_commission_rate_changed: 'Изменена ставка комиссии',
};

export async function HistoryTab({ orgId, prisma }: { orgId: string; prisma: PrismaClient }) {
  const rows = await listOrgHistory(prisma, { orgId });

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
        История пуста.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-xl">
      {rows.map((r) => (
        <li key={r.id} className="px-4 py-3">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{r.user?.name ?? 'Система'}</span>
            <span>{fmtDateTime(r.createdAt)}</span>
          </div>
          <div className="text-sm text-[#111111] mt-0.5">
            {labels[r.action] ?? r.action}
            {r.action === 'partner_commission_rate_changed' && r.meta && (
              <span className="text-gray-500 text-xs ml-2">
                {String((r.meta as { oldRate?: string | null }).oldRate ?? '—')} →{' '}
                {String((r.meta as { newRate?: string | null }).newRate ?? '—')}
                {(r.meta as { reason?: string }).reason &&
                  ` · ${(r.meta as { reason: string }).reason}`}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
