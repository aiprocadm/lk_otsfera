import React from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import type { MyKpiRow } from '@/lib/services/manager/myKpi';

/**
 * «Мои KPI за месяц» на дашборде менеджера (`У-245`, этап 7).
 *
 * Каждая плитка отвечает на три вопроса сразу: сколько у меня, сколько ждут и
 * куда нажать, чтобы это увидеть. Плитка без ссылки была бы тупиком — цифра
 * есть, а откуда она, непонятно.
 *
 * План показывается, только когда он задан. «0 % плана» под незаданным планом
 * читается как невыполнение того, чего человеку не ставили.
 */
function formatValue(unit: MyKpiRow['unit'], raw: string): string {
  if (unit === 'money') return `${Number(raw).toLocaleString('ru-RU')} ₽`;
  if (unit === 'minutes') return `${raw} мин`;
  return raw;
}

function planLine(row: MyKpiRow): string {
  if (row.plan === null) return 'План не задан';
  const plan = `План ${formatValue(row.unit, row.plan)}`;
  return row.percent === null ? plan : `${plan} · ${row.percent} %`;
}

export function MyKpiGrid({ rows, month }: { rows: MyKpiRow[]; month: string }) {
  if (rows.length === 0) {
    return (
      <section className="space-y-3" data-testid="my-kpi">
        <h2 className="text-sm font-semibold text-[#111111]">Мои KPI за месяц</h2>
        <EmptyState
          icon="📊"
          title="Показатели ещё не выбраны"
          message="Руководитель компании пока не отметил, что считать показателями работы. Как только отметит, здесь появятся ваши цифры."
          className="p-6"
        />
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="my-kpi">
      <h2 className="text-sm font-semibold text-[#111111]">Мои KPI за месяц</h2>
      <p className="text-xs text-gray-500">
        Считается только ваш результат за {month}. Нажмите на плитку, чтобы увидеть, из чего она
        сложилась.
      </p>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {rows.map((row) => (
          <Link
            key={row.metric}
            href={row.href}
            data-testid={`my-kpi-${row.metric}`}
            className="block rounded-xl focus-visible:outline-2 focus-visible:outline-[#F97316]"
          >
            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
              <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
                {row.label}
              </div>
              <div className="text-3xl font-bold text-[#111111]">
                {formatValue(row.unit, row.fact)}
              </div>
              <div
                className={
                  row.percent !== null && row.percent >= 100
                    ? 'text-xs text-green-700'
                    : 'text-xs text-gray-500'
                }
              >
                {planLine(row)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
