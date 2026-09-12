import React from 'react';
import { EmptyState } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { DialogMessageView } from '@/lib/services/messengers/get';

/**
 * Лента диалога (спека 2026-09-12 §5.2): входящие слева, исходящие справа;
 * у исходящих — кто написал и, если не дошло, честная пометка. Пустая лента
 * бывает только у диалога, начатого первым и ещё без сообщений — кнопки нет
 * намеренно: форма ответа стоит сразу под лентой (`У-74`).
 */
export function DialogThread({
  messages,
  hiddenCount,
}: {
  messages: DialogMessageView[];
  hiddenCount: number;
}) {
  if (messages.length === 0) {
    return (
      <EmptyState
        icon="💬"
        title="Сообщений пока нет"
        message="Напишите первым — ответ клиента появится здесь."
        className="p-6"
      />
    );
  }
  return (
    <div className="space-y-3">
      {hiddenCount > 0 && (
        <p className="text-center text-xs text-gray-400">
          Показаны последние {messages.length} сообщений, ещё {hiddenCount} старше.
        </p>
      )}
      <ol className="space-y-2" aria-label="Переписка">
        {messages.map((m) => {
          const out = m.direction === 'out';
          return (
            <li key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                  out
                    ? 'rounded-br-sm border border-orange-200 bg-orange-50 text-gray-800'
                    : 'rounded-bl-sm bg-gray-100 text-gray-800'
                }`}
              >
                {out && (
                  <p className="mb-0.5 text-[11px] font-medium text-orange-700">
                    {m.authorName ?? 'Сотрудник'}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className="mt-1 text-[11px] text-gray-400">
                  {fmtDateTime(m.createdAt)}
                  {out && m.deliveryStatus === 'failed' && (
                    <span className="ml-2 text-red-600">не доставлено</span>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
