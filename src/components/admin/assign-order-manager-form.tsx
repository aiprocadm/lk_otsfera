'use client';

import { useState } from 'react';
import { assignOrderManagerAction } from '@/server-actions/admin/manager';
import { useFormAction } from '@/lib/ui/useFormAction';

export type ManagerCandidate = {
  id: string;
  email: string;
  name: string | null;
};

// Дельты поверх errorMessageRu (validation там — generic «Проверьте поля формы.»).
const ERROR_LABELS: Record<string, string> = {
  validation: 'Проверьте выбор менеджера.',
  order_not_found: 'Заказ не найден.',
  invalid_manager: 'Пользователь не является активным менеджером.'
};

export function AssignOrderManagerForm({
  orderId,
  currentManagerId,
  candidates
}: {
  orderId: string;
  currentManagerId: string | null;
  candidates: ManagerCandidate[];
}) {
  const [selected, setSelected] = useState<string>(currentManagerId ?? '');
  const { formAction, pending, errorText, data, success } = useFormAction<{ changed: boolean }>({
    action: assignOrderManagerAction,
    errorMap: ERROR_LABELS
  });

  // Sort candidates: currently-assigned first (when known), then alphabetically.
  const sorted = [...candidates].sort((a, b) => {
    if (a.id === currentManagerId) return -1;
    if (b.id === currentManagerId) return 1;
    return (a.name ?? a.email).localeCompare(b.name ?? b.email);
  });

  const dirty = selected !== (currentManagerId ?? '');

  return (
    <form
      action={formAction}
      className='bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3'
    >
      <input type='hidden' name='orderId' value={orderId} />
      <div>
        <h2 className='text-base font-semibold text-[#111111]'>Менеджер заказа</h2>
        <p className='text-xs text-gray-500 mt-0.5'>
          Прямое назначение менеджера на этот заказ независимо от организации.
        </p>
      </div>

      <label className='block'>
        <span className='block text-sm font-medium text-gray-700 mb-1'>
          Выберите менеджера
        </span>
        <select
          name='managerUserId'
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className='w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]'
        >
          <option value=''>— Без менеджера —</option>
          {sorted.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ? `${c.name} (${c.email})` : c.email}
            </option>
          ))}
        </select>
      </label>

      {success && data && (
        <div
          role='status'
          className='text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2'
        >
          {data.changed ? 'Менеджер обновлён.' : 'Без изменений.'}
        </div>
      )}
      {errorText !== null && (
        <div
          role='alert'
          className='text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2'
        >
          {errorText}
        </div>
      )}

      <div className='flex justify-end'>
        <button
          type='submit'
          disabled={pending || !dirty}
          className='px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50'
        >
          {pending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}
