'use client';

import { useState } from 'react';
import { transitionOrderStatusAction } from '@/server-actions/manager/transitionOrderStatus';
import { useFormAction } from '@/lib/ui/useFormAction';

/**
 * Inline status-change widget rendered under the timeline on the manager-side
 * order detail page. Posts to `transitionOrderStatusAction`, which delegates to
 * `transitionOrderStatus` in `lib/services/manager/status.ts` for the actual
 * RBAC + audit pipeline.
 *
 * The set of manager-settable statuses is intentionally narrower than the full
 * `ExecutionStatus` enum: only `pending | in_progress | completed` are exposed.
 * `cancelled` and `on_hold` are terminal/locked states that are managed by a
 * separate process (admin tooling / future flow), so when the current order is
 * in one of those states we render a read-only notice instead of the form.
 */

type ManagerSettableStatus = 'pending' | 'in_progress' | 'completed';
type ExecutionStatus = ManagerSettableStatus | 'cancelled' | 'on_hold';

const LOCKED_STATES = new Set<ExecutionStatus>(['cancelled', 'on_hold']);

const STATUS_LABEL_RU: Record<ManagerSettableStatus, string> = {
  pending: 'Новый',
  in_progress: 'В работе',
  completed: 'Завершён'
};

// Дельты поверх errorMessageRu (not_found там дословно «Заказ не найден.» — не дублируем).
const ACTION_ERROR_LABEL: Record<string, string> = {
  validation: 'Некорректные данные.',
  invalid_status: 'Недопустимый статус.',
  forbidden: 'Недостаточно прав.'
};

type Props = {
  orderId: string;
  currentStatus: ExecutionStatus;
};

export function ManagerStatusChangeForm({ orderId, currentStatus }: Props) {
  const isLocked = LOCKED_STATES.has(currentStatus);

  const [newStatus, setNewStatus] = useState<ManagerSettableStatus>(
    isLocked ? 'in_progress' : (currentStatus as ManagerSettableStatus)
  );
  // Server-action принимает объект, не FormData — адаптер читает статус из формы.
  const { formAction, pending: isPending, errorText: error } = useFormAction<{
    changed: boolean;
  }>({
    action: (formData) =>
      transitionOrderStatusAction({
        orderId,
        newStatus: String(formData.get('newStatus') ?? '')
      }),
    errorMap: ACTION_ERROR_LABEL
  });

  if (isLocked) {
    const label = currentStatus === 'cancelled' ? 'отменён' : 'на удержании';
    return (
      <div className='bg-white border border-gray-200 rounded-xl p-5'>
        <h2 className='text-sm font-semibold text-[#111111] mb-2'>Изменить статус</h2>
        <p className='text-sm text-gray-500'>
          Заказ {label}; статус управляется отдельным процессом.
        </p>
      </div>
    );
  }

  const noop = newStatus === currentStatus;

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5'>
      <h2 className='text-sm font-semibold text-[#111111] mb-3'>Изменить статус</h2>
      <form action={formAction} className='flex flex-col sm:flex-row sm:items-end gap-3'>
        <label className='text-sm text-gray-700 flex-1'>
          <span className='block text-xs text-gray-500 mb-1'>Новый статус</span>
          <select
            name='newStatus'
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as ManagerSettableStatus)}
            disabled={isPending}
            className='w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent'
          >
            <option value='pending'>{STATUS_LABEL_RU.pending}</option>
            <option value='in_progress'>{STATUS_LABEL_RU.in_progress}</option>
            <option value='completed'>{STATUS_LABEL_RU.completed}</option>
          </select>
        </label>
        <button
          type='submit'
          disabled={isPending || noop}
          className='px-4 py-2 bg-[#F97316] text-white text-sm font-medium rounded-lg hover:bg-[#EA580C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
        >
          {isPending ? 'Сохраняю…' : 'Изменить'}
        </button>
      </form>
      {error && (
        <p role='alert' className='mt-2 text-sm text-red-600'>
          {error}
        </p>
      )}
    </div>
  );
}
