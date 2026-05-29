import React from 'react';
import Link from 'next/link';
import {
  deactivatePartnerFormAction,
  reactivatePartnerFormAction
} from '@/server-actions/admin/partners';
import type { PartnerRow } from '@/lib/services/admin/partners';

const rub = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });

function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return new Intl.NumberFormat('ru-RU', {
    style: 'percent',
    maximumFractionDigits: 2
  }).format(rate);
}

export function PartnersTable({ rows }: { rows: PartnerRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
        Партнёров не найдено
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left">
            <th className="px-4 py-2.5 font-medium text-gray-600">Название</th>
            <th className="px-4 py-2.5 font-medium text-gray-600">Slug</th>
            <th className="px-4 py-2.5 font-medium text-gray-600">Ставка</th>
            <th className="px-4 py-2.5 font-medium text-gray-600">Активных орг</th>
            <th className="px-4 py-2.5 font-medium text-gray-600">Сумма выплат YTD</th>
            <th className="px-4 py-2.5 font-medium text-gray-600">Активен</th>
            <th className="px-4 py-2.5 font-medium text-gray-600 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-gray-50 hover:bg-[#FFF7ED]">
              <td className="px-4 py-2.5 font-medium text-[#111111]">{p.name}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{p.slug}</td>
              <td className="px-4 py-2.5 text-gray-600">{formatRate(p.commissionRate)}</td>
              <td className="px-4 py-2.5 text-gray-600">{p.activeOrgCount}</td>
              <td className="px-4 py-2.5 text-gray-600">{rub.format(Number(p.paidYTD))}</td>
              <td className="px-4 py-2.5">
                {p.isActive ? (
                  <span className="text-green-600 text-xs">●</span>
                ) : (
                  <span className="text-gray-300 text-xs">●</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right">
                <div className="flex items-center justify-end gap-2">
                  <Link href={`/admin/partners/${p.id}`} className="text-[#F97316] text-xs hover:underline">
                    Редактировать
                  </Link>
                  {p.isActive ? (
                    <form action={deactivatePartnerFormAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-gray-500 text-xs hover:text-red-600">
                        Деактивировать
                      </button>
                    </form>
                  ) : (
                    <form action={reactivatePartnerFormAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-gray-500 text-xs hover:text-green-600">
                        Восстановить
                      </button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
