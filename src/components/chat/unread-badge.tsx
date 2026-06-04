'use client';
import React, { useEffect, useState } from 'react';

/**
 * UnreadBadge — polls GET /api/messages/unread every ~15 s to get the total
 * number of unread messages across all threads for the current user.
 * Renders a small orange count badge when count > 0, nothing otherwise.
 */
export function UnreadBadge() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchUnread() {
      try {
        const res = await fetch('/api/messages/unread');
        if (!cancelled && res.ok) {
          const data = (await res.json()) as { count: number };
          setCount(data.count ?? 0);
        }
      } catch {
        // swallow — defensive
      }
    }

    // Poll immediately on mount, then every 15 seconds
    void fetchUnread();
    const id = setInterval(() => {
      void fetchUnread();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (count <= 0) return null;

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
