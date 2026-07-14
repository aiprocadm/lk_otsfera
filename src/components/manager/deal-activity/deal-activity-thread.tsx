'use client';

import React, { useRef, useState } from 'react';
import { Button, Input, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { useFormAction } from '@/lib/ui/useFormAction';
import { addDealNoteAction, initiateCallAction } from '@/server-actions/deal-activity';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';
import { ActivityItemView } from './activity-item';

/**
 * M1 — интерактивная лента активности по сделке (Task 5 UI). Server-компонент
 * `manager-order-detail-view.tsx` грузит `items` через `getDealActivity` и
 * передаёт их сюда read-only; здесь — только фильтр вида (клиент-сайд) и
 * композер (заметка + click-to-call). Ответы в WhatsApp/Telegram/etc НЕ
 * входят в v1 — это остаётся за `/manager/inbox` (см. scope-заметку плана).
 */

type View = 'dialogue' | 'all';

const DIALOGUE_KINDS = new Set<ActivityItem['kind']>(['message_in', 'message_out', 'comment']);
const CHANNEL_KINDS = new Set<ActivityItem['kind']>(['message_in', 'message_out']);

const NOTE_ERROR_LABEL: Record<string, string> = {
  invalid: 'Введите текст заметки.',
  not_found: 'Заказ не найден.'
};

const CALL_ERROR_LABEL: Record<string, string> = {
  disabled: 'Звонки недоступны (модуль не подключён).',
  not_found: 'Заказ не найден.',
  call_failed: 'Звонок недоступен (не настроено).'
};

export function DealActivityThread({
  orderId,
  items,
  inboundEnabled,
  telephonyEnabled
}: {
  orderId: string;
  items: ActivityItem[];
  inboundEnabled: boolean;
  telephonyEnabled: boolean;
}) {
  const [view, setView] = useState<View>('dialogue');
  const [callFormOpen, setCallFormOpen] = useState(false);
  const noteFormRef = useRef<HTMLFormElement>(null);
  const callFormRef = useRef<HTMLFormElement>(null);

  const visible = items.filter((item) => {
    if (!inboundEnabled && CHANNEL_KINDS.has(item.kind)) return false;
    if (view === 'dialogue' && !DIALOGUE_KINDS.has(item.kind)) return false;
    return true;
  });

  const note = useFormAction<{ id: string }>({
    action: (formData) => addDealNoteAction({ orderId, body: String(formData.get('body') ?? '') }),
    errorMap: NOTE_ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Заметка добавлена');
      noteFormRef.current?.reset();
    }
  });

  const call = useFormAction<{ callId: string }>({
    action: (formData) =>
      initiateCallAction({
        orderId,
        toNumber: String(formData.get('toNumber') ?? ''),
        fromInternal: ''
      }),
    errorMap: CALL_ERROR_LABEL,
    onSuccess: () => {
      toast.success('Звонок инициирован');
      callFormRef.current?.reset();
      setCallFormOpen(false);
    }
  });

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-sm font-semibold text-[#111111]'>Активность</h2>
        <div className='flex gap-1'>
          <Button
            type='button'
            size='sm'
            variant={view === 'dialogue' ? 'primary' : 'secondary'}
            onClick={() => setView('dialogue')}
          >
            Диалог
          </Button>
          <Button
            type='button'
            size='sm'
            variant={view === 'all' ? 'primary' : 'secondary'}
            onClick={() => setView('all')}
          >
            Вся активность
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className='text-sm text-gray-500'>Активности пока нет.</p>
      ) : (
        <ul className='space-y-2'>
          {visible.map((item) => (
            <ActivityItemView key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </ul>
      )}

      <div className='border-t border-gray-100 pt-3 space-y-3'>
        <form ref={noteFormRef} action={note.formAction} className='flex flex-col gap-2'>
          <Textarea
            name='body'
            rows={2}
            required
            disabled={note.pending}
            placeholder='Внутренняя заметка — клиент её не видит…'
            aria-label='Текст заметки'
          />
          <div className='flex items-center justify-between gap-2'>
            <Button type='submit' size='sm' loading={note.pending} disabled={note.pending}>
              Добавить заметку
            </Button>
            {note.errorText && (
              <p role='alert' className='text-xs text-red-600'>
                {note.errorText}
              </p>
            )}
          </div>
        </form>

        {telephonyEnabled && (
          <div>
            {!callFormOpen ? (
              <Button type='button' variant='secondary' size='sm' onClick={() => setCallFormOpen(true)}>
                Позвонить
              </Button>
            ) : (
              <form ref={callFormRef} action={call.formAction} className='flex flex-wrap items-center gap-2'>
                <Input
                  name='toNumber'
                  required
                  disabled={call.pending}
                  placeholder='Номер телефона'
                  aria-label='Номер телефона'
                  className='max-w-[200px]'
                />
                <Button type='submit' size='sm' loading={call.pending} disabled={call.pending}>
                  Позвонить
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={call.pending}
                  onClick={() => setCallFormOpen(false)}
                >
                  Отмена
                </Button>
                {call.errorText && (
                  <p role='alert' className='text-xs text-red-600'>
                    {call.errorText}
                  </p>
                )}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
