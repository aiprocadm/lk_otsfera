'use client';

import React, { useId, useRef, useState } from 'react';
import { Button, Input, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { useFormAction } from '@/lib/ui/useFormAction';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';
import { addDealNoteAction, initiateCallAction } from '@/server-actions/deal-activity';
import { replyInboundAction } from '@/server-actions/inbound';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';
import { ActivityItemView, CHANNEL_LABEL } from './activity-item';

/**
 * M1 — интерактивная лента активности по сделке (Task 5 UI). Server-компонент
 * `manager-order-detail-view.tsx` грузит `items` через `getDealActivity` и
 * передаёт их сюда read-only; здесь — фильтр вида (клиент-сайд), композер с
 * тремя режимами (спека M1 §2.3.6: композер выбирает цель) и click-to-call:
 *  - `note`    — внутренняя заметка (`addDealNoteAction`), клиент не видит;
 *  - `comment` — комментарий клиенту (`POST /api/comments`, manager-ветка);
 *  - `channel` — ответ в канал последнего входящего (`replyInboundAction`);
 *    доступен только при `inboundEnabled` и не-email `message_in` — для email
 *    исходящего транспорта нет (`email_unsupported`), режим честно скрыт (E3).
 */

type View = 'dialogue' | 'all';
type ComposerMode = 'note' | 'comment' | 'channel';

const DIALOGUE_KINDS = new Set<ActivityItem['kind']>(['message_in', 'message_out', 'comment']);
const CHANNEL_KINDS = new Set<ActivityItem['kind']>(['message_in', 'message_out']);

const NOTE_ERROR_LABEL: Record<string, string> = {
  invalid: 'Введите текст заметки.',
  not_found: 'Заказ не найден.'
};

/**
 * `POST /api/comments` отдаёт message-строки (`Invalid request`/`Not found`/
 * `Access denied`), а не стабильные коды §3 — центральная карта их не знает,
 * маппим все три здесь.
 */
const COMMENT_ERROR_LABEL: Record<string, string> = {
  'Invalid request': 'Введите текст комментария.',
  'Not found': 'Заказ не найден.',
  'Access denied': 'Нет доступа к заказу.'
};

/**
 * Дельта поверх центральной карты (как в `inbox-reply-form.tsx`): только
 * контекстные уточнения forbidden/not_found; `invalid`/`reply_failed`/
 * `email_unsupported` уже точно покрыты errorMessageRu.
 */
const REPLY_ERROR_LABEL: Record<string, string> = {
  forbidden: 'Обращение недоступно вашей компании.',
  not_found: 'Обращение не найдено.'
};

const CALL_ERROR_LABEL: Record<string, string> = {
  disabled: 'Звонки недоступны (модуль не подключён).',
  not_found: 'Заказ не найден.',
  call_failed: 'Звонок недоступен (не настроено).'
};

const COMPOSER_META: Record<
  ComposerMode,
  { pill: string; ariaLabel: string; placeholder: string; submitLabel: string }
> = {
  note: {
    pill: 'Заметка',
    ariaLabel: 'Текст заметки',
    placeholder: 'Внутренняя заметка — клиент её не видит…',
    submitLabel: 'Добавить заметку'
  },
  comment: {
    pill: 'Комментарий',
    ariaLabel: 'Текст комментария',
    placeholder: 'Комментарий клиенту…',
    submitLabel: 'Отправить комментарий'
  },
  channel: {
    pill: 'Ответ в канал',
    ariaLabel: 'Текст ответа',
    placeholder: 'Ответ клиенту в канал…',
    submitLabel: 'Ответить в канал'
  }
};

type InboundItem = Extract<ActivityItem, { kind: 'message_in' }>;

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
  const [rawMode, setRawMode] = useState<ComposerMode>('note');
  const [callFormOpen, setCallFormOpen] = useState(false);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const callFormRef = useRef<HTMLFormElement>(null);
  const captionId = useId();

  const visible = items.filter((item) => {
    if (!inboundEnabled && CHANNEL_KINDS.has(item.kind)) return false;
    if (!telephonyEnabled && item.kind === 'call') return false;
    if (view === 'dialogue' && !DIALOGUE_KINDS.has(item.kind)) return false;
    return true;
  });

  // Последний входящий — max по дате (сервис сортирует по возрастанию `at`,
  // но не полагаемся на порядок массива); `>=` — при равных датах побеждает
  // последний элемент ленты.
  const lastInbound = items.reduce<InboundItem | null>(
    (last, item) =>
      item.kind === 'message_in' && (!last || item.at.getTime() >= last.at.getTime())
        ? item
        : last,
    null
  );
  // email — replyToInbound всегда отказ (email_unsupported): режим не показываем.
  const channelAvailable = inboundEnabled && lastInbound !== null && lastInbound.channel !== 'email';
  const channelLabel = lastInbound ? (CHANNEL_LABEL[lastInbound.channel] ?? lastInbound.channel) : '';
  const mode: ComposerMode = rawMode === 'channel' && !channelAvailable ? 'note' : rawMode;

  const note = useFormAction<{ id: string }>({
    action: (formData) => addDealNoteAction({ orderId, body: String(formData.get('body') ?? '') }),
    errorMap: NOTE_ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Заметка добавлена');
      composerFormRef.current?.reset();
    }
  });

  const comment = useFetchSubmit({
    url: '/api/comments',
    body: (formData) => ({ orderId, body: String(formData.get('body') ?? '').trim() }),
    errorMap: COMMENT_ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Комментарий отправлен');
      composerFormRef.current?.reset();
    }
  });

  const reply = useFormAction<{ ok: true }>({
    action: (formData) =>
      replyInboundAction({
        /* v8 ignore next -- unreachable: сабмит режима «channel» рендерится только при channelAvailable ⇒ lastInbound non-null; `?? ''` — defensive */
        inboundMessageId: lastInbound?.id ?? '',
        text: String(formData.get('body') ?? '')
      }),
    errorMap: REPLY_ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Ответ отправлен');
      composerFormRef.current?.reset();
    }
  });

  const call = useFormAction<{ callId: string }>({
    action: (formData) =>
      initiateCallAction({
        orderId,
        toNumber: String(formData.get('toNumber') ?? ''),
        fromInternal: String(formData.get('fromInternal') ?? '')
      }),
    errorMap: CALL_ERROR_LABEL,
    onSuccess: () => {
      toast.success('Звонок инициирован');
      callFormRef.current?.reset();
      setCallFormOpen(false);
    }
  });

  const composerByMode = { note, comment, channel: reply } as const;
  const composer = composerByMode[mode];
  const meta = COMPOSER_META[mode];
  const modes: ComposerMode[] = channelAvailable ? ['note', 'comment', 'channel'] : ['note', 'comment'];
  const caption =
    mode === 'note'
      ? 'Внутренняя заметка — клиент её не видит'
      : mode === 'comment'
        ? 'Комментарий клиенту (видит клиент)'
        : `Ответ в канал (${channelLabel})`;

  const selectMode = (m: ComposerMode) => {
    // Смена цели сбрасывает stale-ошибки всех режимов (текст черновика в
    // общей textarea при этом сохраняется).
    note.reset();
    comment.reset();
    reply.reset();
    setRawMode(m);
  };

  return (
    <div className='bg-white border border-gray-200 rounded-xl p-5 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-sm font-semibold text-[#111111]'>Активность</h2>
        <div className='flex gap-1'>
          <Button
            type='button'
            size='sm'
            aria-pressed={view === 'dialogue'}
            variant={view === 'dialogue' ? 'primary' : 'secondary'}
            onClick={() => setView('dialogue')}
          >
            Диалог
          </Button>
          <Button
            type='button'
            size='sm'
            aria-pressed={view === 'all'}
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
        <form ref={composerFormRef} action={composer.formAction} className='flex flex-col gap-2'>
          {/* Пиллы-переключатели — toggle-кнопки (aria-pressed), не radio:
              полная radio-семантика требует roving tabindex + стрелки
              (прецедент — team-visibility-toggle.tsx). */}
          <div className='flex flex-wrap gap-1'>
            {modes.map((m) => (
              <Button
                key={m}
                type='button'
                size='sm'
                aria-pressed={mode === m}
                variant={mode === m ? 'primary' : 'secondary'}
                disabled={composer.pending}
                onClick={() => selectMode(m)}
              >
                {COMPOSER_META[m].pill}
              </Button>
            ))}
          </div>
          <Textarea
            name='body'
            rows={2}
            required
            disabled={composer.pending}
            placeholder={meta.placeholder}
            aria-label={meta.ariaLabel}
            aria-describedby={captionId}
          />
          {/* Privacy-дифференциация: client-visible режимы (comment/channel)
              подписаны предупреждающим тоном; SR слышит подпись при фокусе
              textarea через aria-describedby. */}
          <p
            id={captionId}
            className={mode === 'note' ? 'text-xs text-gray-500' : 'text-xs text-amber-700 font-medium'}
          >
            {caption}
          </p>
          <div className='flex items-center justify-between gap-2'>
            <Button type='submit' size='sm' loading={composer.pending} disabled={composer.pending}>
              {meta.submitLabel}
            </Button>
            {composer.errorText && (
              <p role='alert' className='text-xs text-red-600'>
                {composer.errorText}
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
                  type='tel'
                  required
                  disabled={call.pending}
                  placeholder='Номер телефона'
                  aria-label='Номер телефона'
                  className='max-w-[200px]'
                />
                <Input
                  name='fromInternal'
                  disabled={call.pending}
                  placeholder='Внутренний номер (необяз.)'
                  aria-label='Внутренний номер'
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
