import React from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { OrgOrderConversation } from '@/lib/services/organization/orderConversations';

/**
 * Переписка по заказам у заказчика (`У-332`): заказ → последнее сообщение.
 * Сама переписка — в карточке заказа, сюда приходят, чтобы увидеть, где
 * ответил менеджер.
 */
export function OrgOrderConversations({
  rows,
  orgId,
}: {
  rows: OrgOrderConversation[];
  orgId: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        message="Переписки по заказам пока нет. Написать менеджеру можно в карточке заказа — блок «Комментарии» внизу."
        action={
          <Link
            href={`/organization/orders?org=${orgId}`}
            className="text-sm font-medium text-orange-600 hover:underline"
          >
            Открыть заказы
          </Link>
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
      {rows.map((r) => (
        <li key={r.orderId}>
          <Link
            href={`/organization/orders/${r.orderId}?org=${orgId}#comments`}
            className="block px-4 py-3 hover:bg-gray-50"
            data-testid={`order-conversation-${r.orderId}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-[#111111]">Заказ {r.orderLabel}</span>
              <span className="text-xs text-gray-500">{fmtDateTime(r.lastAt)}</span>
            </div>
            <p className="mt-0.5 text-sm text-gray-700 line-clamp-2">
              <span className={r.lastFromStaff ? 'font-medium text-orange-700' : 'text-gray-500'}>
                {r.lastAuthorName}:
              </span>{' '}
              {r.lastBody}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              {r.count} {plural(r.count)} в переписке
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function plural(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'сообщение';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'сообщения';
  return 'сообщений';
}
