'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { transferOrderAction } from '@/server-actions/manager/orderAssignment';

export type TransferCandidate = { id: string; name: string | null; email: string };

const ERROR_LABELS: Record<string, string> = {
  validation: 'Выберите, кому передать заказ.',
  forbidden: 'Передать можно только свой заказ. Обновите страницу.',
  invalid_manager: 'Этот сотрудник недоступен — выберите другого.',
  order_not_found: 'Заказ не найден — обновите страницу.',
};

/**
 * «Передать заказ» (`У-283`, ТЗ 13.10.2026) — на карточке СВОЕГО заказа у
 * менеджера. Руководитель и администратор меняют ответственного своими формами
 * (sibling-правило §4: у них другой экшен и другой охват). Новый ответственный
 * получает уведомление «Вам передан заказ», смена видна в истории заказа.
 */
export function ManagerTransferOrderForm({
  orderId,
  candidates,
}: {
  orderId: string;
  candidates: TransferCandidate[];
}) {
  const router = useRouter();
  const [toUserId, setToUserId] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await transferOrderAction({ orderId, toUserId });
      if (!res.ok) {
        toast.error(resolveErrorText(res.error, ERROR_LABELS));
        return;
      }
      const to = candidates.find((c) => c.id === toUserId);
      toast.success(`Заказ передан: ${to?.name ?? to?.email ?? 'коллеге'}.`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3"
    >
      <div>
        <h2 className="text-base font-semibold text-[#111111]">Передать заказ</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Если заказ дальше ведёт коллега — передайте его: он получит уведомление, а смена
          ответственного попадёт в историю заказа.
        </p>
      </div>
      {candidates.length === 0 ? (
        <p className="text-sm text-gray-500">
          В вашей компании нет других менеджеров — передать заказ некому.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1">
            <span className="block text-sm font-medium text-gray-700 mb-1">Кому</span>
            <Select
              aria-label="Кому передать заказ"
              value={toUserId}
              disabled={pending}
              onChange={(e) => setToUserId(e.target.value)}
            >
              <option value="">— выберите коллегу —</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ? `${c.name} (${c.email})` : c.email}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" disabled={!toUserId || pending} loading={pending}>
            Передать
          </Button>
        </div>
      )}
    </form>
  );
}
