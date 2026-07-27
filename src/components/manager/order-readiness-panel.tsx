'use client';
import React from 'react';

import { useState, useTransition } from 'react';
import { toast } from '@/lib/ui/toast';
import { Badge, Button } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import {
  ITEM_GAP_RU,
  ORDER_GAP_RU,
  type OrderReadiness
} from '@/lib/orders/readiness';
import {
  approveDeliverablesAction,
  deliverOrderResultAction
} from '@/server-actions/manager/orderDelivery';

/**
 * Этап 12 (Модуль 5, ФТ-5.1/5.2) — блок «Готовность к передаче» на деталке
 * заказа у сотрудника.
 *
 * Показывает не «чего-то не хватает», а ЧЕГО именно и по какому слушателю.
 * Кнопка «Передать результат клиенту» активна только при полной готовности;
 * передача однократна (решение заказчика §6-3) — после неё блок показывает
 * дату и кнопку не рисует.
 */
export function OrderReadinessPanel({
  orderId,
  serviceType,
  readiness,
  deliveredAt,
  deliverablesApproved
}: {
  orderId: string;
  serviceType: 'training' | 'document_development';
  readiness: OrderReadiness;
  deliveredAt: string | null;
  deliverablesApproved: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [delivered, setDelivered] = useState<string | null>(deliveredAt);
  const [approved, setApproved] = useState(deliverablesApproved);
  const [error, setError] = useState<string | null>(null);

  function runDeliver() {
    setError(null);
    startTransition(async () => {
      const res = await deliverOrderResultAction({ orderId });
      if (res.ok) {
        setDelivered(res.deliveredAt);
        toast.success(
          res.alreadyDelivered ? 'Результат уже был передан' : 'Результат передан клиенту'
        );
        return;
      }
      setError(
        res.error === 'not_ready'
          ? 'Заказ ещё не готов к передаче — см. список ниже.'
          : 'Не удалось передать результат. Обновите страницу и попробуйте ещё раз.'
      );
    });
  }

  function runApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approveDeliverablesAction({ orderId });
      if (res.ok) {
        setApproved(true);
        toast.success('Работа отмечена согласованной');
        return;
      }
      setError('Не удалось поставить отметку. Обновите страницу и попробуйте ещё раз.');
    });
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-sm font-medium text-gray-500 uppercase tracking-wider'>
          Готовность к передаче
        </h2>
        {delivered ? (
          <Badge tone='success'>Передан {fmtDate(new Date(delivered))}</Badge>
        ) : readiness.ready ? (
          <Badge tone='success'>Готов</Badge>
        ) : (
          <Badge tone='warning'>Не готов</Badge>
        )}
      </div>

      {!delivered && readiness.gaps.length > 0 && (
        <ul className='text-sm text-gray-700 space-y-1 list-disc pl-5'>
          {readiness.gaps.map((g) => (
            <li key={g}>{ORDER_GAP_RU[g]}</li>
          ))}
        </ul>
      )}

      {!delivered && readiness.items.length > 0 && (
        <div className='text-sm text-gray-700'>
          <p className='text-xs text-gray-500 mb-1'>По слушателям:</p>
          <ul className='space-y-1'>
            {readiness.items.map((item) => (
              <li key={item.itemId}>
                <span className='font-medium'>{item.studentName}</span>
                <span className='text-gray-500'>
                  {' — '}
                  {item.gaps.map((g) => ITEM_GAP_RU[g]).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role='alert' className='text-sm text-red-600'>
          {error}
        </p>
      )}

      {!delivered && (
        <div className='flex flex-wrap gap-2 pt-1'>
          {serviceType === 'document_development' && !approved && (
            <Button type='button' variant='secondary' disabled={pending} onClick={runApprove}>
              Отметить работу согласованной
            </Button>
          )}
          <Button type='button' disabled={pending || !readiness.ready} onClick={runDeliver}>
            {pending ? 'Передаём…' : 'Передать результат клиенту'}
          </Button>
        </div>
      )}

      {delivered && (
        <p className='text-sm text-gray-500'>
          Клиент получил уведомление. Повторная передача не требуется — довоз
          результата обсуждайте комментариями к заказу.
        </p>
      )}
    </div>
  );
}
