import React from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import type { SourcesResult } from '@/lib/services/leader/sources';

/**
 * «Откуда приходят клиенты» (`У-247`, этап 7) — блок внутри вкладки «Воронка».
 *
 * Два справочника источников показаны рядом, а не слиты: у лида это канал или
 * система, откуда он пришёл, у обращения — кабинет происхождения. Слияние дало
 * бы правдоподобную, но выдуманную цифру.
 */
export function SourcesPanel({ data }: { data: SourcesResult }) {
  if (data.leads.length === 0 && data.requests.length === 0) {
    return (
      <div data-testid="sources-panel">
        <EmptyState
          icon="🧭"
          title="За этот период новых лидов и обращений не было"
          message="Выберите другой месяц вверху страницы."
          className="p-6"
        />
      </div>
    );
  }

  const totalPct =
    data.totalLeads > 0 ? Math.round((data.totalOrders / data.totalLeads) * 100) : null;

  return (
    <div className="space-y-5" data-testid="sources-panel">
      <section className="space-y-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">
          Лиды по источникам
        </h3>
        <p className="text-xs text-gray-500">
          Конверсия когортная: берутся лиды, заведённые за период, и смотрится, во что они выросли —
          когда бы это ни случилось.
        </p>
        {data.leads.length > 0 ? (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                  <th className="py-2">Источник</th>
                  <th className="py-2">Лидов</th>
                  <th className="py-2">Стали сделкой</th>
                  <th className="py-2">Стали заказом</th>
                  <th className="py-2">Конверсия</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((r) => (
                  <tr key={r.source} className="border-b border-gray-100">
                    <td className="py-2">{r.label}</td>
                    <td className="py-2">{r.leads}</td>
                    <td className="py-2">{r.deals}</td>
                    <td className="py-2">{r.orders}</td>
                    <td className="py-2">
                      {r.conversionPct === null ? '—' : `${r.conversionPct} %`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-sm text-gray-700">
              Всего: {data.totalLeads} лидов, из них дошли до сделки {data.totalDeals}, стали
              заказом {data.totalOrders}
              {totalPct !== null && ` (${totalPct} %)`}.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">Новых лидов за период не было.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-gray-500">
          Обращения по источникам
        </h3>
        <p className="text-xs text-gray-500">
          У обращения свой справочник: откуда его отправили — из кабинета заказчика, партнёра или с
          сайта.
        </p>
        {data.requests.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {data.requests.map((r) => (
              <li key={r.source} className="flex gap-x-3">
                <span className="min-w-[12rem] text-gray-700">{r.label}</span>
                <span className="text-gray-500">{r.requests}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">Обращений за период не было.</p>
        )}
      </section>
    </div>
  );
}
