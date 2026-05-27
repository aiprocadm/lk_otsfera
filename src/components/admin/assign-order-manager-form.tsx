'use client';

import { useState, useTransition } from 'react';
import {
  assignOrderManagerAction,
  type AssignOrderManagerActionResult
} from '@/server-actions/admin/manager';

export type ManagerCandidate = {
  id: string;
  email: string;
  name: string | null;
};

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
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { kind: 'ok'; changed: boolean } | { kind: 'err'; label: string } | null
  >(null);

  // Sort candidates: currently-assigned first (when known), then alphabetically.
  const sorted = [...candidates].sort((a, b) => {
    if (a.id === currentManagerId) return -1;
    if (b.id === currentManagerId) return 1;
    return (a.name ?? a.email).localeCompare(b.name ?? b.email);
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    const fd = new FormData();
    fd.set('orderId', orderId);
    fd.set('managerUserId', selected);
    startTransition(async () => {
      const res: AssignOrderManagerActionResult = await assignOrderManagerAction(fd);
      if (res.ok) {
        setFeedback({ kind: 'ok', changed: res.changed });
      } else {
        setFeedback({ kind: 'err', label: ERROR_LABELS[res.error] ?? `Ошибка: ${res.error}` });
      }
    });
  }

  const dirty = selected !== (currentManagerId ?? '');

  return (
    <form
      onSubmit={onSubmit}
      className='bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3'
    >
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

      {feedback?.kind === 'ok' && (
        <div className='text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2'>
          {feedback.changed ? 'Менеджер обновлён.' : 'Без изменений.'}
        </div>
      )}
      {feedback?.kind === 'err' && (
        <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2'>
          {feedback.label}
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
