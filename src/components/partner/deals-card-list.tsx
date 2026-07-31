import React from 'react';
import Link from 'next/link';
import type { DealRow } from '@/lib/services/partner/deals';
import { DealStatusBadge } from './deal-status-badge';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

// The only call site guards with `d.deadline && (...)`, so `d` is always
// non-null here — the null-guard branch was unreachable dead code.
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(d);
}

export function DealsCardList({ rows }: { rows: DealRow[] }) {
  if (rows.length === 0) return null;

  return (
    <ul className="md:hidden space-y-2">
      {rows.map((d) => (
        <li key={d.id}>
          <Link
            href={`/partner/deals/${d.id}`}
            className="block bg-white border border-gray-200 rounded-xl p-4 active:bg-[#FFF7ED]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#111111] truncate">{d.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {d.orderNumber ? <>№ {d.orderNumber} · </> : null}
                  {d.organizationName}
                </div>
              </div>
              <DealStatusBadge stage={d.stage} />
            </div>

            <div className="mt-2.5 flex items-center justify-between text-sm">
              <span className="text-gray-700">{fmtMoney(d.totalAmount)}</span>
              <span className={Number(d.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-400'}>
                {Number(d.debt) > 0 ? `Долг ${fmtMoney(d.debt)}` : 'Без долга'}
              </span>
            </div>

            {d.deadline && (
              <div className="mt-1 text-xs text-gray-500">Срок: {fmtDate(d.deadline)}</div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
