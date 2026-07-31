import React from 'react';
import Link from 'next/link';
import type { AttentionItem } from '@/lib/services/manager/dashboard';

export function ManagerAttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">
        Ничего срочного — отдохните.
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-[#111111] mb-3">Требует внимания</h2>
      <ul className="space-y-2 text-sm">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-3">
            <span
              className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                it.severity === 'urgent' ? 'bg-red-500' : 'bg-amber-500'
              }`}
              aria-hidden="true"
            />
            <Link
              href={it.href}
              className={`${
                it.severity === 'urgent' ? 'text-red-700' : 'text-amber-700'
              } hover:text-[#F97316] flex-1 min-w-0 truncate`}
            >
              {it.message}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
