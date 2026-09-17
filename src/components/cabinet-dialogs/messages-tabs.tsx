import React from 'react';
import Link from 'next/link';

/**
 * Вкладки раздела «Сообщения» у заказчика и партнёра (`У-234`).
 *
 * Два разных домена на одном экране: переписка с менеджером (канал кабинета и
 * мессенджеры) и обсуждение по заказам (командный чат). Вкладка показывается,
 * только если её домен включён, — иначе человек ткнул бы в пустое место.
 * Компонент один на оба кабинета (`Р-23`, правило зеркала): названия и порядок
 * вкладок одинаковы.
 */
export type MessagesTabKey = 'manager' | 'orders';

const MESSAGES_TAB_LABELS: Record<MessagesTabKey, string> = {
  manager: 'Переписка с менеджером',
  orders: 'По заказам',
};

export function MessagesTabs({
  basePath,
  active,
  tabs,
  query,
}: {
  /** `/organization/messages` или `/partner/messages`. */
  basePath: string;
  active: MessagesTabKey;
  /** Доступные вкладки в общем порядке. */
  tabs: MessagesTabKey[];
  /** Хвост адреса (например, активная организация) — чтобы переход не увёл в другую. */
  query?: Record<string, string> | undefined;
}) {
  if (tabs.length < 2) return null;
  return (
    <nav className="flex flex-wrap gap-2 border-b border-gray-200" data-testid="messages-tabs">
      {tabs.map((tab) => {
        const params = new URLSearchParams({ ...(query ?? {}), tab });
        const isActive = tab === active;
        return (
          <Link
            key={tab}
            href={`${basePath}?${params.toString()}`}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'border-b-2 border-[#F97316] px-3 py-2 text-sm font-medium text-[#111111]'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-gray-500 hover:text-[#111111]'
            }
          >
            {MESSAGES_TAB_LABELS[tab]}
          </Link>
        );
      })}
    </nav>
  );
}
