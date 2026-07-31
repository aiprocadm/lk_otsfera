import React from 'react';
import Link from 'next/link';
import type { Attention } from '@/lib/services/partner/dashboard';
import { fmtDate } from '@/lib/format';

export function AttentionList({ data }: { data: Attention }) {
  const empty = data.stuckOrders.length === 0 && data.overdueOrders.length === 0;

  if (empty) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
        Всё под контролем — ничего не зависло.
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-[#111111] mb-3">Требует внимания</h2>
      <ul className="space-y-2 text-sm">
        {data.stuckOrders.map((o) => (
          <li key={`stuck-${o.id}`} className="flex items-center justify-between gap-3">
            <Link
              href={`/partner/deals/${o.id}`}
              className="text-gray-700 hover:text-[#F97316] flex-1 min-w-0 truncate"
            >
              🕒 Заказ «{o.title}» завис
            </Link>
            <span className="text-gray-400 text-xs whitespace-nowrap">
              обн. {fmtDate(o.updatedAt)}
            </span>
          </li>
        ))}
        {data.overdueOrders.map((o) => (
          <li key={`overdue-${o.id}`} className="flex items-center justify-between gap-3">
            <Link
              href={`/partner/deals/${o.id}`}
              className="text-red-700 hover:underline flex-1 min-w-0 truncate"
            >
              ⚠ Просрочка: «{o.title}»
            </Link>
            <span className="text-gray-400 text-xs whitespace-nowrap">
              до {o.deadline ? fmtDate(o.deadline) : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
