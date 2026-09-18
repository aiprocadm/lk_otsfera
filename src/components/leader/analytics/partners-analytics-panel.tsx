import React from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import type { PartnersAnalyticsResult } from '@/lib/services/leader/partnersAnalytics';

/**
 * «Партнёры» (`У-243`, этап 7): начислено и выплачено, живые организации,
 * обращения. В отчёт попадают партнёры, у которых есть организация этой
 * компании, — иначе руководитель увидел бы чужих.
 */
function money(v: string): string {
  return `${Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`;
}

export function PartnersAnalyticsPanel({ data }: { data: PartnersAnalyticsResult }) {
  if (data.rows.length === 0) {
    return (
      <div data-testid="partners-panel">
        <EmptyState
          icon="🤝"
          title="Партнёров у компании пока нет"
          message="Партнёр появляется здесь, когда за ним закреплена хотя бы одна организация компании."
          className="p-6"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="partners-panel">
      <p className="text-sm text-gray-700">
        Начислено за период: <span className="font-medium">{money(data.totalAccrued)}</span> · из
        них выплачено: <span className="font-medium">{money(data.totalPaid)}</span>
      </p>
      <p className="text-xs text-gray-500">
        Черновики актов в начисление не входят: их ещё можно переписать целиком.
      </p>

      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <th className="py-2">Партнёр</th>
              <th className="py-2">Организаций</th>
              <th className="py-2">Начислено</th>
              <th className="py-2">Выплачено</th>
              <th className="py-2">Обращений</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.partnerId} className="border-b border-gray-100">
                <td className="py-2">
                  <Link
                    href={`/admin/partners/${r.partnerId}`}
                    className="text-[#F97316] hover:underline"
                  >
                    {r.partnerName}
                  </Link>
                </td>
                <td className="py-2">{r.organizations}</td>
                <td className="py-2">{money(r.accrued)}</td>
                <td className="py-2">{money(r.paid)}</td>
                <td className="py-2">{r.requests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {data.rows.map((r) => (
          <li key={r.partnerId} className="rounded-xl border border-gray-200 bg-white p-3">
            <Link
              href={`/admin/partners/${r.partnerId}`}
              className="text-sm font-medium text-[#F97316]"
            >
              {r.partnerName}
            </Link>
            <p className="mt-1 text-xs text-gray-500">
              Организаций: {r.organizations} · обращений: {r.requests}
            </p>
            <p className="text-sm text-gray-700">
              Начислено {money(r.accrued)}, выплачено {money(r.paid)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
