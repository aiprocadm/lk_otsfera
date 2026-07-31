'use client';
import React, { useState } from 'react';
import { useFetchSubmit } from '@/lib/ui/useFetchSubmit';

const MAX_LEN = 5000;

/**
 * `POST /api/comments` отдаёт message-строки (`Invalid request`/`Not found`/
 * `Access denied`), а не стабильные коды §3 — центральная карта их не знает,
 * маппим здесь (та же дельта, что в manager/deal-activity-thread).
 */
const ERROR_MAP: Record<string, string> = {
  'Invalid request': 'Введите текст комментария.',
  'Not found': 'Заказ не найден.',
  'Access denied': 'Нет доступа к заказу.',
};

export function AddCommentForm({ orderId }: { orderId: string }) {
  const [body, setBody] = useState('');
  const { formAction, pending, errorText } = useFetchSubmit({
    url: '/api/comments',
    body: () => ({ orderId, body: body.trim() }),
    errorMap: ERROR_MAP,
    onSuccess: () => setBody(''),
    refresh: true,
  });

  return (
    <form action={formAction} className="space-y-2 pt-3 border-t border-gray-100">
      <label className="block">
        <span className="sr-only">Новый комментарий</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={MAX_LEN}
          placeholder="Написать комментарий…"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-[#F97316] resize-y"
        />
      </label>

      {errorText && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2">
          {errorText}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {body.length}/{MAX_LEN}
        </span>
        <button
          type="submit"
          disabled={pending || body.trim().length === 0}
          className="px-3 py-1.5 text-sm bg-[#F97316] text-white rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
        >
          {pending ? 'Отправка…' : 'Отправить'}
        </button>
      </div>
    </form>
  );
}
