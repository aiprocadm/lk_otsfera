'use client';

import React, { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Textarea } from '@/components/ui';
import { toast } from '@/lib/ui/toast';
import { useFormAction } from '@/lib/ui/useFormAction';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';
import { addDealNoteAction } from '@/server-actions/deal-activity';
import { replyInboundAction } from '@/server-actions/inbound';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';
import { noteFromClientMessage } from '@/lib/orders/noteFromMessage';
import { ActivityItemView, CHANNEL_LABEL } from '@/components/manager/deal-activity/activity-item';

/**
 * «Переписка с клиентом» в карточке заказа (этап 6 ТЗ 13.10.2026, `У-310`,
 * `Р-6-10`): здесь — только то, что видит клиент: комментарии к заказу
 * (`Comment`) и сообщения каналов. Отдельный блок с голубой рамкой и
 * пометкой «Видит клиент», а внутренние заметки — в «Активности»: заметку
 * сюда не написать, сообщение отсюда — не спрятать.
 *
 * У сообщения клиента — «Создать заметку из этого сообщения»: цитата и
 * комментарий менеджера уходят во внутренние заметки заказа (`DealNote`).
 * Таблицы `Comment` и заметок не меняются (`Р-Б-8`).
 *
 * `children` — список диалогов в мессенджерах (`OrderDialogsPanel`,
 * `embedded`): та же переписка с клиентом, только по каналам.
 */

type Mode = 'comment' | 'channel';
type InboundItem = Extract<ActivityItem, { kind: 'message_in' }>;
type CommentItem = Extract<ActivityItem, { kind: 'comment' }>;

const CLIENT_KINDS = new Set<ActivityItem['kind']>(['comment', 'message_in', 'message_out']);
const CHANNEL_KINDS = new Set<ActivityItem['kind']>(['message_in', 'message_out']);

/**
 * `POST /api/comments` отдаёт message-строки, а не стабильные коды §3 —
 * центральная карта их не знает, маппим здесь.
 */
const COMMENT_ERROR_LABEL: Record<string, string> = {
  'Invalid request': 'Введите текст сообщения.',
  'Not found': 'Заказ не найден.',
  'Access denied': 'Нет доступа к заказу.',
};

const REPLY_ERROR_LABEL: Record<string, string> = {
  forbidden: 'Обращение недоступно вашей компании.',
  not_found: 'Обращение не найдено.',
};

const NOTE_ERROR_LABEL: Record<'invalid' | 'not_found', string> = {
  invalid: 'Заметка получилась пустой.',
  not_found: 'Заказ не найден.',
};

export function OrderClientThread({
  orderId,
  items,
  inboundEnabled,
  children,
}: {
  orderId: string;
  items: ActivityItem[];
  inboundEnabled: boolean;
  children?: React.ReactNode;
}) {
  const [rawMode, setRawMode] = useState<Mode>('comment');
  const formRef = useRef<HTMLFormElement>(null);
  const captionId = useId();

  const visible = items.filter(
    (item) => CLIENT_KINDS.has(item.kind) && (inboundEnabled || !CHANNEL_KINDS.has(item.kind))
  );

  // Последний входящий — max по дате; `>=` — при равных датах побеждает
  // последний элемент ленты (порядок массива не гарантирован).
  const lastInbound = items.reduce<InboundItem | null>(
    (last, item) =>
      item.kind === 'message_in' && (!last || item.at.getTime() >= last.at.getTime()) ? item : last,
    null
  );
  const channelAvailable = inboundEnabled && lastInbound !== null;
  const channelLabel = lastInbound
    ? (CHANNEL_LABEL[lastInbound.channel] ?? lastInbound.channel)
    : '';
  const mode: Mode = rawMode === 'channel' && !channelAvailable ? 'comment' : rawMode;

  const comment = useFetchSubmit({
    url: '/api/comments',
    body: (formData) => ({ orderId, body: String(formData.get('body') ?? '').trim() }),
    errorMap: COMMENT_ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Сообщение отправлено клиенту');
      formRef.current?.reset();
    },
  });

  const reply = useFormAction<{ ok: true }>({
    action: (formData) =>
      replyInboundAction({
        /* v8 ignore next -- unreachable: режим «channel» доступен только при channelAvailable ⇒ lastInbound non-null; `?? ''` — defensive */
        inboundMessageId: lastInbound?.id ?? '',
        text: String(formData.get('body') ?? ''),
      }),
    errorMap: REPLY_ERROR_LABEL,
    refresh: true,
    onSuccess: () => {
      toast.success('Ответ отправлен');
      formRef.current?.reset();
    },
  });

  const composer = mode === 'comment' ? comment : reply;

  const selectMode = (m: Mode) => {
    // Смена цели сбрасывает устаревшие ошибки (черновик в поле остаётся).
    comment.reset();
    reply.reset();
    setRawMode(m);
  };

  return (
    <section
      className="space-y-4 rounded-xl border border-sky-300 bg-white p-5"
      aria-label="Переписка с клиентом"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-[#111111]">Переписка с клиентом</h2>
          <Badge tone="info">Видит клиент</Badge>
        </div>
        <p className="text-xs text-gray-500">
          Всё, что вы пишете здесь, увидит клиент. Заметка для своих — в «Активности».
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">
          Сообщений по заказу пока нет. Напишите клиенту — он увидит сообщение в своём кабинете.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => (
            <ActivityItemView
              key={`${item.kind}-${item.id}`}
              item={item}
              footer={
                isFromClient(item) ? <MakeNoteFromMessage orderId={orderId} item={item} /> : null
              }
            />
          ))}
        </ul>
      )}

      <form ref={formRef} action={composer.formAction} className="flex flex-col gap-2">
        {channelAvailable && (
          <div className="flex flex-wrap gap-1">
            {(['comment', 'channel'] as const).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                aria-pressed={mode === m}
                variant={mode === m ? 'primary' : 'secondary'}
                disabled={composer.pending}
                onClick={() => selectMode(m)}
              >
                {m === 'comment' ? 'В кабинет' : `В ${channelLabel}`}
              </Button>
            ))}
          </div>
        )}
        <Textarea
          name="body"
          rows={2}
          required
          disabled={composer.pending}
          placeholder="Сообщение клиенту…"
          aria-label="Текст сообщения клиенту"
          aria-describedby={captionId}
        />
        <p id={captionId} className="text-xs font-medium text-sky-800">
          {mode === 'comment'
            ? 'Клиент увидит сообщение в карточке заказа в своём кабинете.'
            : `Ответ уйдёт клиенту в ${channelLabel}.`}
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button type="submit" size="sm" loading={composer.pending} disabled={composer.pending}>
            Отправить клиенту
          </Button>
          {composer.errorText && (
            <p role="alert" className="text-xs text-red-600">
              {composer.errorText}
            </p>
          )}
        </div>
      </form>

      {children && <div className="border-t border-gray-100 pt-3">{children}</div>}
    </section>
  );
}

function isFromClient(item: ActivityItem): item is InboundItem | CommentItem {
  return item.kind === 'message_in' || (item.kind === 'comment' && item.fromClient);
}

/**
 * «Создать заметку из этого сообщения»: сообщение клиента копируется во
 * внутренние заметки заказа вместе с комментарием менеджера.
 */
function MakeNoteFromMessage({
  orderId,
  item,
}: {
  orderId: string;
  item: InboundItem | CommentItem;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  if (!open) {
    return (
      <button
        type="button"
        className="mt-1 text-xs text-[#EA580C] hover:underline"
        onClick={() => setOpen(true)}
      >
        Создать заметку из этого сообщения
      </button>
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await addDealNoteAction({
      orderId,
      body: noteFromClientMessage({
        comment: text,
        author: item.kind === 'message_in' ? item.sender : item.author,
        at: item.at,
        body: item.body,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(NOTE_ERROR_LABEL[res.error]);
      return;
    }
    toast.success('Заметка добавлена в «Активность»');
    setOpen(false);
    setText('');
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
      <label htmlFor={fieldId} className="block text-xs font-medium text-gray-700">
        Ваш комментарий к заметке (клиент не увидит)
      </label>
      <Textarea
        id={fieldId}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        placeholder="Например: договорились созвониться в пятницу"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" loading={busy} onClick={() => void save()}>
          Сохранить в заметки
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Отмена
        </Button>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
