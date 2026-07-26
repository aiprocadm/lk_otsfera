import React from 'react';
import { Badge } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/format';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';

/**
 * M1 — единая лента активности по сделке (Task 5 UI). Чисто презентационный
 * компонент: один `switch` по дискриминанту `kind`, без побочных эффектов и
 * без запросов. Владелец списка/фильтра/композера — `DealActivityThread`.
 *
 * Формат даты — общий `@/lib/format` (`fmtDate`/`fmtDateTime`), а не локальный
 * дубль: только `message_in`/`message_out` (буквально «сообщения») получают
 * время, остальные виды — только дату.
 */

/**
 * Словарь каналов — консистентен с inbox-компонентами (`inbox-list.tsx`).
 * Экспортируется: композер ленты (`DealActivityThread`) подписывает им режим
 * «Ответ в канал ({label})».
 */
export const CHANNEL_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  max: 'MAX',
  whatsapp: 'WhatsApp',
  email: 'Email',
  cabinet: 'Вопрос из кабинета'
};

const DIRECTION_LABEL: Record<string, string> = {
  inbound: 'Входящий',
  outbound: 'Исходящий'
};

const DIRECTION_TONE: Record<string, 'success' | 'info'> = {
  inbound: 'success',
  outbound: 'info'
};

function fmtDuration(sec: number | null): string {
  if (sec == null || Number.isNaN(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ActivityItemView({ item }: { item: ActivityItem }) {
  switch (item.kind) {
    case 'message_in':
      return (
        <li className='flex justify-start'>
          <div className='max-w-[85%] rounded-xl rounded-tl-sm border border-gray-200 bg-white px-3 py-2'>
            <div className='flex flex-wrap items-center gap-2 mb-1'>
              <Badge tone='neutral'>{CHANNEL_LABEL[item.channel] ?? item.channel}</Badge>
              <span className='text-xs font-semibold text-[#111111]'>{item.sender}</span>
              <span className='text-xs text-gray-400'>{fmtDateTime(item.at)}</span>
            </div>
            <p className='text-sm text-gray-700 whitespace-pre-wrap break-words'>{item.body}</p>
            {item.attachmentName && (
              <p className='mt-1 text-xs text-gray-500'>📎 {item.attachmentName}</p>
            )}
          </div>
        </li>
      );

    case 'message_out':
      return (
        <li className='flex justify-end'>
          <div className='max-w-[85%] rounded-xl rounded-tr-sm border border-orange-200 bg-orange-50 px-3 py-2'>
            <div className='flex items-center justify-end gap-2 mb-1'>
              <span className='text-xs font-semibold text-[#111111]'>{item.author}</span>
              <span className='text-xs text-gray-400'>{fmtDateTime(item.at)}</span>
            </div>
            <p className='text-sm text-gray-700 whitespace-pre-wrap break-words'>
              {item.body}
              {item.hasAttachment && (
                <span className='ml-1' aria-hidden='true'>
                  📎
                </span>
              )}
            </p>
          </div>
        </li>
      );

    case 'comment':
      return (
        <li className='flex justify-end'>
          <div className='max-w-[85%] rounded-xl rounded-tr-sm border border-gray-200 bg-gray-50 px-3 py-2'>
            <div className='flex items-center justify-end gap-2 mb-1'>
              <span className='text-xs font-semibold text-[#111111]'>{item.author}</span>
              <span className='text-xs text-gray-400'>{fmtDate(item.at)}</span>
            </div>
            <p className='text-sm text-gray-700 whitespace-pre-wrap break-words'>{item.body}</p>
          </div>
        </li>
      );

    case 'call':
      return (
        <li className='flex justify-center'>
          <div className='inline-flex flex-wrap items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-600'>
            <span aria-hidden='true'>📞</span>
            <Badge tone={DIRECTION_TONE[item.direction] ?? 'neutral'}>
              {DIRECTION_LABEL[item.direction] ?? item.direction}
            </Badge>
            {item.initiator && (
              <span className='font-medium text-gray-700'>{item.initiator}</span>
            )}
            <span>{item.number}</span>
            <span>{fmtDuration(item.durationSec)}</span>
            {item.recordingReady && <span>▶ запись</span>}
            <span className='text-gray-400'>{fmtDate(item.at)}</span>
          </div>
        </li>
      );

    case 'note':
      return (
        <li>
          <div className='rounded-lg border border-amber-200 bg-amber-50 px-3 py-2'>
            <div className='flex flex-wrap items-center gap-2 mb-1'>
              <span className='text-xs font-semibold text-[#111111]'>{item.author}</span>
              <Badge tone='warning'>Клиент не видит</Badge>
              <span className='text-xs text-gray-400 ml-auto'>{fmtDate(item.at)}</span>
            </div>
            <p className='text-sm text-gray-700 whitespace-pre-wrap break-words'>{item.body}</p>
          </div>
        </li>
      );

    case 'event':
      return (
        <li className='flex justify-center'>
          <span className='inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-500'>
            {item.label} · {fmtDate(item.at)}
          </span>
        </li>
      );
  }
}
