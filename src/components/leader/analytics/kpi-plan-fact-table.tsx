import React from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import type { KpiPlanFactResult, KpiPlanFactRow } from '@/lib/kpi/plan';

/**
 * План и факт по показателям компании (`У-242`, `У-243`).
 *
 * Процент показывается только там, где план задан: «0 %» под пустым планом
 * читается как невыполнение того, чего человеку не ставили.
 */
function value(row: KpiPlanFactRow, raw: string): string {
  if (row.unit === 'money') return `${Number(raw).toLocaleString('ru-RU')} ₽`;
  if (row.unit === 'minutes') return `${raw} мин`;
  return raw;
}

function trend(row: KpiPlanFactRow): string {
  const now = Number(row.fact);
  const was = Number(row.prevFact);
  if (!Number.isFinite(now) || !Number.isFinite(was) || was === 0) return '—';
  const delta = Math.round(((now - was) / was) * 100);
  if (delta === 0) return 'как в прошлом месяце';
  return delta > 0 ? `+${delta} % к прошлому` : `${delta} % к прошлому`;
}

export function KpiPlanFactTable({ data }: { data: KpiPlanFactResult }) {
  if (data.metrics.length === 0 || data.rows.length === 0) {
    return (
      <div data-testid="kpi-plan-fact">
        <EmptyState
          icon="🎯"
          title="Показатели не выбраны"
          message="Откройте «Настройки → Показатели и планы» и отметьте, что считает компания."
          className="p-6"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="kpi-plan-fact">
      {data.metrics.map((metric) => {
        const rows = data.rows.filter((r) => r.metric === metric.key);
        return (
          <section key={metric.key} className="space-y-2">
            <h2 className="text-lg font-semibold text-[#111111]">{metric.label}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                  <th className="py-2">Кто</th>
                  <th className="py-2">План</th>
                  <th className="py-2">Факт</th>
                  <th className="py-2">Выполнение</th>
                  <th className="py-2">Динамика</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.metric}:${r.managerId ?? 'total'}`}
                    className={
                      r.managerId === null
                        ? 'border-b border-gray-200 font-medium'
                        : 'border-b border-gray-100'
                    }
                    data-testid={`kpi-row-${r.metric}-${r.managerId ?? 'total'}`}
                  >
                    <td className="py-2">{r.managerName}</td>
                    <td className="py-2">
                      {r.plan === null ? (
                        <span className="text-gray-400">план не задан</span>
                      ) : (
                        value(r, r.plan)
                      )}
                    </td>
                    <td className="py-2">{value(r, r.fact)}</td>
                    <td className="py-2">{r.percent === null ? '—' : `${r.percent} %`}</td>
                    <td className="py-2 text-gray-500">{trend(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
