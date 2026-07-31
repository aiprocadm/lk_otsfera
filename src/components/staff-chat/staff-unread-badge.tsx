'use client';
import React from 'react';
import { useClientResource } from '@/hooks/useClientResource';

/**
 * StaffUnreadBadge — поллит GET /api/staff-chat/unread (~15с) и показывает
 * оранжевый бейдж с числом непрочитанных бесед команды. Ничего не рендерит
 * при count<=0. Sibling к UnreadBadge (order-comment домен) — тот же
 * visibility-gated поллинг через useClientResource.
 */
export function StaffUnreadBadge() {
  const { data: count } = useClientResource<number>('/api/staff-chat/unread', {
    intervalMs: 15_000,
    select: (d) => (d as { count?: number }).count ?? 0,
  });

  if (!count || count <= 0) return null;

  return (
    <span
      aria-label="Непрочитанные сообщения команды"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '20px',
        height: '20px',
        padding: '0 6px',
        borderRadius: '10px',
        backgroundColor: '#F97316',
        color: '#ffffff',
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: 1,
        marginLeft: '8px',
        verticalAlign: 'middle',
      }}
    >
      {count}
    </span>
  );
}
