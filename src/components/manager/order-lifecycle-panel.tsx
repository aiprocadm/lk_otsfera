'use client';

import React, { useState, useTransition } from 'react';
import { Badge, Button, Dialog, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import {
  transitionOrderLifecycleAction,
  setOrderAccountingSignedAction
} from '@/server-actions/manager/orderLifecycle';
import type { CompletionCondition } from '@/lib/orders/completion';

type LifecycleStatus = 'new' | 'in_progress' | 'waiting_client' | 'completed';

const STATUS_RU: Record<LifecycleStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  waiting_client: 'Ждём клиента',
  completed: 'Завершён'
};

const STATUS_TONE: Record<LifecycleStatus, 'neutral' | 'info' | 'warning' | 'success'> = {
  new: 'neutral',
  in_progress: 'info',
  waiting_client: 'warning',
  completed: 'success'
};

/**
 * Локальная копия графа переходов. Источник истины — ALLOWED_TRANSITIONS в
 * src/lib/services/manager/orderLifecycle.ts (:22-27); при изменении графа в
 * сервисе синхронизировать и здесь. Сервис всё равно валидирует переход —
 * рассинхрон даст invalid_transition, а не тихую порчу данных.
 */
const TRANSITIONS: Record<LifecycleStatus, ReadonlyArray<{ to: LifecycleStatus; label: string }>> = {
  new: [{ to: 'in_progress', label: 'В работу' }],
  in_progress: [
    { to: 'waiting_client', label: 'Ждём клиента' },
    { to: 'completed', label: 'Завершить' }
  ],
  waiting_client: [{ to: 'in_progress', label: 'Вернуть в работу' }],
  completed: [{ to: 'in_progress', label: 'Переоткрыть' }]
};

/** RU-лейблы кодов условий завершения (src/lib/orders/completion.ts:16-19). */
const UNMET_RU: Record<CompletionCondition, string> = {
  documents_uploaded: 'Нет чистого документа',
  accounting_signed: 'Бухгалтерия не подписана',
  certificates_issued: 'Не выданы удостоверения'
};

// Дельта поверх errorMessageRu: центральный forbidden — про загрузку документов;
// здесь контекст — доступ к заказу. reason_required / invalid_transition /
// not_found уже корректны в центральной карте.
const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Нет доступа к этому заказу.'
};

/**
 * A4 (§5.2/§5.4/§5.6/§21 ТЗ): панель жизненного цикла заказа на оси
 * `Order.status` — НЕ путать с операционным `executionStatus`, которым двигает
 * ManagerStatusChangeForm блоком выше. Успешные экшены сами ревалидируют
 * деталку и списки (revalidateOrder в server-actions/manager/orderLifecycle.ts),
 * поэтому router.refresh здесь не нужен.
 */
export function OrderLifecyclePanel({
  orderId,
  status,
  accountingSigned,
  returnReason
}: {
  orderId: string;
  status: LifecycleStatus;
  accountingSigned: boolean;
  returnReason: string | null;
}) {
  // Один pending на обе мутации (переходы + чекбокс) — сознательная сериализация
  // записей по одному заказу; второй useTransition вернул бы конкурирующие записи.
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [unmet, setUnmet] = useState<CompletionCondition[]>([]);

  // `??`-фолбэки — runtime forward-compat: новое значение OrderStatus из БД не
  // должно ронять деталку до синхронизации словарей (тип его уже не пропустит).
  const transitions = TRANSITIONS[status] ?? [];
  const statusLabel = STATUS_RU[status] ?? status;
  const statusTone = STATUS_TONE[status] ?? 'neutral';

  function runTransition(to: LifecycleStatus, transitionReason?: string) {
    setUnmet([]);
    startTransition(async () => {
      const res = await transitionOrderLifecycleAction({
        orderId,
        to,
        ...(transitionReason !== undefined ? { reason: transitionReason } : {})
      });
      if (res.ok) {
        setDialogOpen(false);
        toast.success('Статус заказа обновлён');
        return;
      }
      if (res.error === 'completion_conditions_unmet') {
        setUnmet(res.unmet);
        return;
      }
      toast.error(resolveErrorText(res.error, ERROR_LABELS));
    });
  }

  function onTransitionClick(to: LifecycleStatus) {
    if (to === 'waiting_client') {
      setReason('');
      setDialogOpen(true);
      return;
    }
    runTransition(to);
  }

  function onReasonSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    runTransition('waiting_client', reason.trim());
  }

  function onToggleSigned(e: React.ChangeEvent<HTMLInputElement>) {
    const signed = e.target.checked;
    startTransition(async () => {
      const res = await setOrderAccountingSignedAction({ orderId, signed });
      if (res.ok) {
        // Галочка закрывает одноимённое условие завершения — точечно убираем его
        // из показанного unmet-списка; остальные условия остаются актуальными.
        setUnmet((prev) => prev.filter((c) => c !== 'accounting_signed'));
        toast.success('Отметка бухгалтерии обновлена');
      } else {
        toast.error(resolveErrorText(res.error, ERROR_LABELS));
      }
    });
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='text-sm font-semibold text-[#111111]'>Жизненный цикл</h2>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>
      <p className='text-xs text-gray-400'>Операционный статус — в блоке выше</p>

      {status === 'waiting_client' && returnReason && (
        <p className='text-sm text-gray-600'>
          <span className='font-medium text-gray-700'>Причина ожидания:</span> {returnReason}
        </p>
      )}

      {transitions.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {transitions.map((t) => (
            <Button
              key={t.to}
              variant='secondary'
              size='sm'
              disabled={pending}
              onClick={() => onTransitionClick(t.to)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      )}

      <div aria-live='polite' data-testid='completion-unmet'>
        {unmet.length > 0 && (
          <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 space-y-1'>
            <p>Не выполнены условия завершения:</p>
            <ul className='list-disc pl-5'>
              {unmet.map((code) => (
                <li key={code}>{UNMET_RU[code]}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <label className='flex items-center gap-2 text-sm text-gray-700'>
        <input
          type='checkbox'
          checked={accountingSigned}
          disabled={pending}
          onChange={onToggleSigned}
          className='h-4 w-4 rounded border-gray-300 accent-[#F97316]'
        />
        Бухгалтерия подписана
      </label>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title='Перевод в «Ждём клиента»'
        busy={pending}
      >
        <form onSubmit={onReasonSubmit} className='space-y-3'>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder='Чего ждём от клиента: документы, оплату, ответ…'
            disabled={pending}
          />
          <div className='flex justify-end gap-2'>
            <Button variant='ghost' onClick={() => setDialogOpen(false)} disabled={pending}>
              Отмена
            </Button>
            <Button type='submit' disabled={!reason.trim()} loading={pending}>
              Перевести
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
