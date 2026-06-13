'use client';
import React from 'react';
import { useClientResource } from '@/hooks/useClientResource';

/**
 * UnreadBadge — поллит GET /api/messages/unread (~15с) и показывает оранжевый
 * бейдж с числом непрочитанных. Ничего не рендерит при count<=0.
 * Поллинг visibility-gated (через useClientResource): на скрытой вкладке не
 * стучит, догружает при возврате фокуса.
 */
export function UnreadBadge() {
  const { data: count } = useClientResource<number>('/api/messages/unread', {
    intervalMs: 15_000,
    select: (d) => (d as { count?: number }).count ?? 0,
  });

  if (!count || count <= 0) return null;

  return (
    <span
      aria-label="Непрочитанные сообщения"
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
        verticalAlign: 'middle'
      }}
    >
      {count}
    </span>
  );
}
