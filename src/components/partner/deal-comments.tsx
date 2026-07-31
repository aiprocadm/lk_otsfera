import React from 'react';
import type { DealCommentRow } from '@/lib/services/partner/dealDetail';
import { AddCommentForm } from './add-comment-form';

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function DealComments({
  comments,
  orderId,
}: {
  comments: DealCommentRow[];
  orderId: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-[#111111]">
        Комментарии{' '}
        {comments.length > 0 && (
          <span className="text-gray-400 font-normal">({comments.length})</span>
        )}
      </h2>

      {comments.length === 0 ? (
        <p className="text-sm text-gray-500">Комментариев пока нет.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-[#F97316] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {c.authorName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-semibold text-[#111111]">{c.authorName}</div>
                  <div className="text-xs text-gray-400">{fmtDateTime(c.createdAt)}</div>
                </div>
                <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddCommentForm orderId={orderId} />
    </div>
  );
}
