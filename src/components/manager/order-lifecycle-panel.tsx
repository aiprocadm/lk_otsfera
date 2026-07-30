'use client';

/**
 * Отметка «Бухгалтерия подписана» на карточке заявки.
 *
 * §10 ТЗ v0.5 (этап 2, PR-3): переходы статуса уехали в
 * [`OrderStatusPanel`](../orders/order-status-panel.tsx) — он строит кнопки из
 * справочника, а не из захардкоженной матрицы. Здесь остался сам факт подписи:
 * он не статус, а событие, по которому статус ставится автоматически (якорь
 * `accounting_signed`).
 *
 * Прежний сервис `transitionOrderLifecycle` и его экшен пока не удалены —
 * уборка запланирована на PR-4 вместе со снятием старого enum `Order.status`.
 */

import React, { useTransition } from 'react';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { setOrderAccountingSignedAction } from '@/server-actions/manager/orderLifecycle';

const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Нет доступа к этому заказу.'
};

export function OrderLifecyclePanel({
  orderId,
  accountingSigned,
  returnReason
}: {
  orderId: string;
  accountingSigned: boolean;
  /** Причина последнего возврата клиенту — историческое поле, показываем как есть. */
  returnReason?: string | null;
}) {
  const [pending, startTransition] = useTransition();

  function onToggleSigned(e: React.ChangeEvent<HTMLInputElement>) {
    const signed = e.target.checked;
    startTransition(async () => {
      const res = await setOrderAccountingSignedAction({ orderId, signed });
      if (res.ok) {
        toast.success('Отметка бухгалтерии обновлена');
      } else {
        toast.error(resolveErrorText(res.error, ERROR_LABELS));
      }
    });
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
      <h2 className='text-sm font-semibold text-[#111111]'>Бухгалтерия</h2>

      {returnReason && (
        <p className='text-xs text-gray-500'>Причина последнего возврата: {returnReason}</p>
      )}

      <label className='flex items-center gap-2 text-sm cursor-pointer'>
        <input
          type='checkbox'
          checked={accountingSigned}
          disabled={pending}
          onChange={onToggleSigned}
          className='h-4 w-4 rounded border-gray-300 accent-[#F97316]'
        />
        Бухгалтерия подписана
      </label>
    </div>
  );
}
