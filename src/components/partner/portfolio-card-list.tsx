import React from 'react';
import Link from 'next/link';
import type { PortfolioItem } from '@/lib/services/partner/portfolio';

function fmtMoney(s: string): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(s)) + ' ₽';
}

export function PortfolioCardList({ items }: { items: PortfolioItem[] }) {
  if (items.length === 0) return null;

  return (
    <ul className="md:hidden space-y-2">
      {items.map((org) => (
        <li key={org.id}>
          <Link
            href={`/partner/portfolio/${org.id}`}
            className="block bg-white border border-gray-200 rounded-xl p-4 active:bg-[#FFF7ED]"
          >
            <div className="font-medium text-[#111111]">{org.name}</div>
            <div className="text-xs text-gray-500 mt-1">{org.inn ?? 'ИНН не указан'}</div>
            <div className="flex justify-between items-center mt-2 text-sm">
              <span className="text-gray-500">{org.ordersCount} сделок</span>
              <span className={Number(org.debt) > 0 ? 'text-red-700 font-medium' : 'text-gray-500'}>
                Долг: {fmtMoney(org.debt)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
