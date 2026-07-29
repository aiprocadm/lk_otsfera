'use client';

/**
 * §10 ТЗ v0.5 — рабочий статус заявки на карточке.
 *
 * Заменяет прежнюю панель жизненного цикла, у которой список переходов был
 * захардкожен и дублировал матрицу из сервиса. Теперь кнопки строятся из
 * справочника: вперёд — следующая активная стадия, назад — предыдущая (только
 * администратору и руководителю), плюс отмена с любой стадии.
 *
 * Проверка условий закрытия (§5.6) никуда не делась — она переехала в сервис
 * и возвращается тем же кодом `completion_conditions_unmet`.
 */

import React, { useState, useTransition } from 'react';
import { Badge, Button, Dialog, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { resolveErrorText } from '@/lib/ui/useFormAction';
import { transitionOrderStatusAction } from '@/server-actions/orderStatuses';
import type { CompletionCondition } from '@/lib/orders/completion';

export type StatusOption = {
  id: string;
  label: string;
  isTerminal: boolean;
  /** Ставится системой по событию — вручную такой статус не выбирают. */
  isAuto: boolean;
};

export type StatusHistoryRow = {
  id: string;
  createdAt: Date | string;
  fromLabel: string | null;
  toLabel: string;
  userName: string | null;
  reason: string | null;
};

const ERROR_LABELS: Record<string, string> = {
  forbidden: 'Нет доступа к этой заявке.',
  backward_forbidden: 'Вернуть заявку на предыдущую стадию могут администратор и руководитель.',
  reason_required: 'Укажите причину отмены.',
  status_inactive: 'Этот статус выключен в справочнике.'
};

const UNMET_RU: Record<CompletionCondition, string> = {
  documents_uploaded: 'Нет чистого документа',
  accounting_signed: 'Бухгалтерия не подписана',
  certificates_issued: 'Не выданы удостоверения'
};

function fmtWhen(value: Date | string): string {
  const d = new Date(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

export type OrderStatusPanelProps = {
  orderId: string;
  /** Текущий статус; null — заявка ещё без рабочего статуса. */
  current: { id: string; label: string; isTerminal: boolean } | null;
  /** Куда можно перейти вперёд (по порядку справочника). */
  forward: StatusOption[];
  /** Куда можно вернуть назад; пусто, если роль не имеет права. */
  backward: StatusOption[];
  /** Терминальный статус («Отменена»), если он активен. */
  terminal: StatusOption | null;
  history: StatusHistoryRow[];
};

export function OrderStatusPanel({
  orderId,
  current,
  forward,
  backward,
  terminal,
  history
}: OrderStatusPanelProps) {
  const [pending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [unmet, setUnmet] = useState<CompletionCondition[]>([]);

  function run(toId: string, transitionReason?: string) {
    setUnmet([]);
    startTransition(async () => {
      const res = await transitionOrderStatusAction({
        orderId,
        toId,
        ...(transitionReason !== undefined ? { reason: transitionReason } : {})
      });
      if (res.ok) {
        setCancelOpen(false);
        toast.success('Статус заявки обновлён');
        return;
      }
      if (res.error === 'completion_conditions_unmet') {
        setUnmet(res.unmet);
        return;
      }
      toast.error(resolveErrorText(res.error, ERROR_LABELS));
    });
  }

  function onCancelSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    run(terminal!.id, reason.trim());
  }

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='text-sm font-semibold text-[#111111]'>Статус заявки</h2>
        <Badge tone={current?.isTerminal ? 'warning' : current ? 'info' : 'neutral'}>
          {current?.label ?? 'Без статуса'}
        </Badge>
      </div>

      {unmet.length > 0 && (
        <div role='alert' className='rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm'>
          <p className='font-medium text-amber-800'>Заявку пока нельзя закрыть:</p>
          <ul className='list-disc list-inside text-amber-700'>
            {unmet.map((c) => (
              <li key={c}>{UNMET_RU[c]}</li>
            ))}
          </ul>
        </div>
      )}

      <div className='flex flex-wrap gap-2'>
        {forward.map((s) => (
          <Button key={s.id} size='sm' disabled={pending} onClick={() => run(s.id)}>
            {s.label}
          </Button>
        ))}
        {backward.map((s) => (
          <Button
            key={s.id}
            size='sm'
            variant='secondary'
            disabled={pending}
            onClick={() => run(s.id)}
          >
            ← {s.label}
          </Button>
        ))}
        {terminal && !current?.isTerminal && (
          <Button
            size='sm'
            variant='danger'
            disabled={pending}
            onClick={() => {
              setReason('');
              setCancelOpen(true);
            }}
          >
            {terminal.label}
          </Button>
        )}
      </div>

      {forward.length === 0 && backward.length === 0 && !terminal && (
        <p className='text-sm text-gray-500'>Доступных переходов нет.</p>
      )}

      {history.length > 0 && (
        <div className='space-y-1 pt-1'>
          <h3 className='text-xs font-semibold text-gray-500'>История статусов</h3>
          <ul className='space-y-1'>
            {history.map((h) => (
              <li key={h.id} className='text-xs text-gray-600'>
                {fmtWhen(h.createdAt)} · {h.fromLabel ?? '—'} → <b>{h.toLabel}</b>
                {h.userName ? ` · ${h.userName}` : ''}
                {h.reason ? ` · ${h.reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={terminal ? terminal.label : 'Отмена заявки'}
        busy={pending}
      >
        <form onSubmit={onCancelSubmit} className='space-y-3'>
          <label htmlFor='cancel-reason' className='block text-xs font-medium text-gray-700'>
            Причина — обязательна
          </label>
          <Textarea
            id='cancel-reason'
            rows={3}
            required
            value={reason}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className='flex justify-end gap-2'>
            <Button type='button' variant='secondary' onClick={() => setCancelOpen(false)}>
              Не отменять
            </Button>
            <Button type='submit' variant='danger' disabled={pending}>
              Подтвердить
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
