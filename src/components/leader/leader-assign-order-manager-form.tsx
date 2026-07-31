'use client';

import React, { useState } from 'react';
import { Button, Select } from '@/components/ui';
import { assignOrderManagerLeaderAction } from '@/server-actions/manager/orderAssignment';
import { useFormAction } from '@/lib/ui/useFormAction';

export type LeaderManagerCandidate = {
  id: string;
  email: string;
  name: string | null;
};

// Дельты поверх errorMessageRu: validation там — generic «Проверьте поля формы.»,
// forbidden — «Нет прав на загрузку.» (про документы, вводит в заблуждение).
// order_not_found и invalid_manager центральные тексты точны — без дельт.
const ERROR_LABELS: Record<string, string> = {
  validation: 'Проверьте выбор менеджера.',
  forbidden: 'Нет доступа к этому заказу.',
};

/**
 * A3 (§5.3 manual assignment): руководитель назначает менеджера своей компании
 * на заказ с деталки /leader/orders/[id]. Sibling admin-версии
 * (assign-order-manager-form.tsx, §4 sibling-rule): та же структура, но экшен —
 * leader-вариант с объектной сигнатурой и same-company guard (C8).
 */
export function LeaderAssignOrderManagerForm({
  orderId,
  currentManagerId,
  candidates,
}: {
  orderId: string;
  currentManagerId: string | null;
  candidates: LeaderManagerCandidate[];
}) {
  const [selected, setSelected] = useState<string>(currentManagerId ?? '');
  // Ресинк при внешнем изменении currentManagerId (например, claim «Взять в
  // работу» внутри деталки → revalidate): иначе форма показывала бы устаревший
  // выбор с активной «Сохранить», снимающей только что взятый заказ. Паттерн
  // «adjusting state when props change» (setState в рендере), НЕ key-ремоунт —
  // тот стирал бы success-нотис после собственного сабмита формы.
  const [prevManagerId, setPrevManagerId] = useState(currentManagerId);
  if (prevManagerId !== currentManagerId) {
    setPrevManagerId(currentManagerId);
    setSelected(currentManagerId ?? '');
  }
  const { formAction, pending, errorText, data, success } = useFormAction<{ changed: boolean }>({
    // Экшен принимает объект (не FormData): адаптер извлекает выбор из формы;
    // '' (опция «— Без менеджера —») → null по схеме экшена (string|null).
    // Каст безопасен: select с name=managerUserId всегда в разметке формы.
    action: (formData) =>
      assignOrderManagerLeaderAction({
        orderId,
        managerUserId: (formData.get('managerUserId') as string) || null,
      }),
    errorMap: ERROR_LABELS,
  });

  // Сортировка кандидатов: текущий менеджер первым (если назначен), потом алфавит.
  const sorted = [...candidates].sort((a, b) => {
    if (a.id === currentManagerId) return -1;
    if (b.id === currentManagerId) return 1;
    return (a.name ?? a.email).localeCompare(b.name ?? b.email);
  });

  const dirty = selected !== (currentManagerId ?? '');

  return (
    <form
      action={formAction}
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3"
    >
      <div>
        <h2 className="text-base font-semibold text-[#111111]">Менеджер заказа</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Назначение менеджера вашей компании на этот заказ.
        </p>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-gray-700 mb-1">Выберите менеджера</span>
        <Select name="managerUserId" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— Без менеджера —</option>
          {sorted.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ? `${c.name} (${c.email})` : c.email}
            </option>
          ))}
        </Select>
      </label>

      {success && data && (
        <div
          role="status"
          className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2"
        >
          {data.changed ? 'Менеджер обновлён.' : 'Без изменений.'}
        </div>
      )}
      {errorText !== null && (
        <div
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2"
        >
          {errorText}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty} loading={pending}>
          {pending ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </div>
    </form>
  );
}
