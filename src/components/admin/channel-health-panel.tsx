import React from 'react';
import { fmtDateTime } from '@/lib/format';
import { DIALOG_CHANNEL_LABELS } from '@/lib/services/messengers/channels';
import type { ChannelHealthRow } from '@/lib/services/messengers/channelHealth';

/**
 * Светофор каналов переписки (`У-213`).
 *
 * Отвечает на три вопроса (§15): где я — заголовок; что здесь — подзаголовок;
 * что дальше — кнопки проверки рядом с каждым каналом (их передаёт страница).
 *
 * Важное правило показа: «ни одного входящего» и «входящих не было сегодня» —
 * разные вещи, и мы их не смешиваем. Пустое значение подписано словами, а не
 * прочерком: прочерк человек читает как «сломалось».
 */
export function ChannelHealthPanel({
  rows,
  actionsFor,
}: {
  rows: ChannelHealthRow[];
  /** Кнопки проверки канала — приходят со страницы (серверные действия). */
  actionsFor?: (channel: string) => React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-[#111111]">Как работают каналы</h2>
        <p className="text-xs text-gray-500">
          Приходят ли сообщения от клиентов и уходят ли ответы. Если входящих давно нет, а клиенты
          пишут — проверьте вебхук.
        </p>
      </div>

      <ul className="space-y-3">
        {rows.map((row) => (
          <li
            key={row.channel}
            className="rounded-lg border border-gray-100 p-3"
            data-testid={`channel-health-${row.channel}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-[#111111]">
                {DIALOG_CHANNEL_LABELS[row.channel]}
              </span>
              {actionsFor?.(row.channel)}
            </div>
            <p className="mt-1 text-xs text-gray-600">
              Последнее входящее:{' '}
              {row.lastInboundAt ? (
                fmtDateTime(row.lastInboundAt)
              ) : (
                <span className="text-gray-500">ни одного сообщения ещё не приходило</span>
              )}
            </p>
            {row.lastErrorAt ? (
              <p className="mt-1 text-xs text-red-600" data-testid={`channel-error-${row.channel}`}>
                Последняя ошибка отправки: {fmtDateTime(row.lastErrorAt)}
                {row.lastError ? ` · ${row.lastError}` : ''}
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">Ошибок отправки не было.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
