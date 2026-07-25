'use client';

import React from 'react';
import { Button, EmptyState, Input, TableShell, THead, Th, Tr, Td } from '@/components/ui';
import { fmtMoney } from '@/lib/format';
import { toast } from '@/lib/ui/toast';
import { useFormAction } from '@/lib/ui/useFormAction';
import { upsertSalesTargetAction } from '@/server-actions/leader/analytics';
import type { PlanFactRow, PlanFactTotals } from '@/lib/services/leader/analytics';

/**
 * M3 — план/факт по менеджерам (Task 3). Клиентский компонент только ради
 * inline-редактора плана (useFormAction-идиома, как в deal-activity-thread);
 * «Без менеджера» и строка итогов остаются read-only.
 */

const TARGET_ERROR_LABEL: Record<string, string> = {
  invalid: 'Некорректная сумма плана.',
  not_found: 'Менеджер не найден.',
  invalid_period: 'Некорректный период.',
  forbidden: 'Нет прав на изменение плана.',
  // upsertSalesTargetAction возвращает 'disabled' при выключенном флаге
  // leader_analytics (тот же паттерн, что 'disabled' в CALL_ERROR_LABEL)
  disabled: 'Модуль аналитики отключён.'
};

function fmtPct(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(1)}%`;
}

function ExecutionBar({ pct }: { pct: number | null }) {
  return (
    <div className='space-y-1'>
      <span className='text-sm text-gray-700'>{fmtPct(pct)}</span>
      {pct !== null && (
        <div className='h-1.5 w-24 rounded-full bg-gray-100 overflow-hidden'>
          <div
            data-testid='execution-bar'
            className='h-full bg-[#F97316] rounded-full'
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PlanCell({
  managerId,
  name,
  year,
  month,
  target
}: {
  managerId: string;
  name: string;
  year: number;
  month: number;
  target: string | null;
}) {
  const { formAction, pending, errorText } = useFormAction<object>({
    action: (formData) => {
      const raw = String(formData.get('targetAmount') ?? '').trim();
      return upsertSalesTargetAction({ managerId, year, month, targetAmount: raw === '' ? null : raw });
    },
    errorMap: TARGET_ERROR_LABEL,
    refresh: true,
    onSuccess: () => toast.success('План сохранён')
  });

  return (
    <form action={formAction} className='flex items-center gap-2'>
      <Input
        type='number'
        name='targetAmount'
        step='0.01'
        min='0'
        defaultValue={target ?? ''}
        disabled={pending}
        aria-label={`План для ${name}`}
        className='w-28'
      />
      <Button type='submit' size='sm' variant='secondary' loading={pending} disabled={pending}>
        Сохранить
      </Button>
      {errorText && (
        <p role='alert' className='text-xs text-red-600'>
          {errorText}
        </p>
      )}
    </form>
  );
}

export function PlanFactTable({
  year,
  month,
  rows,
  totals
}: {
  year: number;
  month: number;
  rows: PlanFactRow[];
  totals: PlanFactTotals;
}) {
  if (rows.length === 0) {
    return <EmptyState message='Нет данных за выбранный период.' />;
  }

  return (
    <TableShell overflow='x-auto'>
      <THead>
        <Th>Менеджер</Th>
        <Th>План</Th>
        <Th>Факт</Th>
        <Th>Выполнение</Th>
        <Th>Завершено заказов</Th>
        <Th>Выиграно сделок</Th>
      </THead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.managerId ?? 'unassigned'}>
            <Td>
              <div className='font-medium text-[#111111]'>{r.name}</div>
              {r.email && <div className='text-xs text-gray-500'>{r.email}</div>}
            </Td>
            <Td>
              {r.managerId ? (
                <PlanCell managerId={r.managerId} name={r.name} year={year} month={month} target={r.target} />
              ) : (
                <span className='text-gray-400'>—</span>
              )}
            </Td>
            <Td className='text-gray-700'>{fmtMoney(r.fact)}</Td>
            <Td>
              <ExecutionBar pct={r.executionPct} />
            </Td>
            <Td className='text-gray-700'>{r.completedOrders}</Td>
            <Td className='text-gray-700'>
              {r.wonDeals > 0 ? (
                <>
                  {r.wonDeals} <span className='text-xs text-gray-500'>({fmtMoney(r.wonAmount)})</span>
                </>
              ) : (
                '—'
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
      <tfoot>
        <Tr hover={false} className='bg-gray-50 font-semibold'>
          <Td className='text-[#111111]'>Итого</Td>
          <Td className='text-[#111111]'>{fmtMoney(totals.target)}</Td>
          <Td className='text-[#111111]'>{fmtMoney(totals.fact)}</Td>
          <Td>
            <ExecutionBar pct={totals.executionPct} />
          </Td>
          <Td>—</Td>
          <Td>—</Td>
        </Tr>
      </tfoot>
    </TableShell>
  );
}
