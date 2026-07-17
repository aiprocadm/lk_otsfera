import React from 'react';
import { EmptyState, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { fmtMoney } from '@/lib/format';
import type { StageSnapshot, CohortStats, ManagerFunnelRow } from '@/lib/services/leader/analytics';

/**
 * M3 — презентация когортной конверсии воронки (Task 3). Чисто серверный /
 * презентационный компонент: KPI-плитки за период, снапшот открытых стадий
 * «сейчас» (полоски relative to max) и разбивка по менеджерам. Собственный
 * `Tile` — sibling-паттерн §4, у org-card-tabs своя копия того же вида.
 */

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='rounded-lg bg-[#F3F4F6] px-4 py-3'>
      <p className='text-xs text-gray-500'>{label}</p>
      <p className='text-lg font-semibold text-[#111111]'>{value}</p>
    </div>
  );
}

export function FunnelAnalyticsPanel({
  snapshot,
  cohort,
  perManager
}: {
  snapshot: StageSnapshot[];
  cohort: CohortStats;
  perManager: ManagerFunnelRow[];
}) {
  const maxCount = Math.max(0, ...snapshot.map((s) => s.count));
  const hasOpenLeads = maxCount > 0;

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-2 sm:grid-cols-5 gap-3'>
        <Tile label='Создано' value={cohort.total} />
        <Tile label='Передано в работу' value={cohort.promoted} />
        <Tile label='Отказы' value={cohort.rejected} />
        <Tile label='Конверсия' value={`${cohort.conversionPct}%`} />
        <Tile
          label='Ср. дней до передачи'
          value={cohort.avgDaysToPromote !== null ? cohort.avgDaysToPromote : '—'}
        />
      </div>

      <div>
        <h2 className='text-sm font-semibold text-[#111111] mb-3'>Открытые лиды по стадиям</h2>
        {!hasOpenLeads ? (
          <EmptyState message='Открытых лидов нет' />
        ) : (
          <div className='space-y-3'>
            {snapshot.map((s) => (
              <div key={s.stageId} className='space-y-1'>
                <div className='flex items-center justify-between text-sm'>
                  <span className='font-medium text-[#111111]'>{s.name}</span>
                  <span className='text-gray-500'>
                    {s.count} · {fmtMoney(s.estimatedSum)}
                  </span>
                </div>
                <div className='h-2 rounded-full bg-gray-100 overflow-hidden'>
                  <div
                    data-testid='stage-bar'
                    className='h-full bg-[#F97316] rounded-full'
                    style={{ width: `${(s.count / maxCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className='text-sm font-semibold text-[#111111] mb-3'>По менеджерам</h2>
        {cohort.total === 0 ? (
          <EmptyState message='Лидов за период нет' />
        ) : (
          <TableShell>
            <THead>
              <Th>Менеджер</Th>
              <Th>Лидов</Th>
              <Th>Передано</Th>
              <Th>Отказы</Th>
              <Th>Конверсия</Th>
            </THead>
            <tbody>
              {perManager.map((m) => (
                <Tr key={m.managerId ?? 'unassigned'}>
                  <Td className='font-medium text-[#111111]'>{m.name}</Td>
                  <Td className='text-gray-700'>{m.assigned}</Td>
                  <Td className='text-gray-700'>{m.promoted}</Td>
                  <Td className='text-gray-700'>{m.rejected}</Td>
                  <Td className='text-gray-700'>{m.conversionPct}%</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>
    </div>
  );
}
