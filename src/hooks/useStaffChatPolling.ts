'use client';
import { useEffect, useRef } from 'react';

export type StaffPolledRow = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  scanStatus: string;
  createdAt: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
};

/**
 * Polls GET /api/staff-chat/messages?conversationId=&after=<latest createdAt>
 * every `intervalMs` while conversationId is set and document.visibilityState
 * === 'visible'. Calls onNew with rows newer than the latest seen.
 *
 * Sibling of useThreadPolling (chat domain) — identical mechanics (cursor/onNew
 * live in refs so the effect only depends on [conversationId, intervalMs]),
 * staff-chat URL/shape.
 */
export function useStaffChatPolling(
  conversationId: string | null,
  latestCreatedAt: string | null,
  onNew: (rows: StaffPolledRow[]) => void,
  intervalMs = 7000
): void {
  const cursorRef = useRef<string | null>(latestCreatedAt);
  const onNewRef = useRef<(rows: StaffPolledRow[]) => void>(onNew);

  // Keep refs in sync each render without recreating the interval
  useEffect(() => {
    cursorRef.current = latestCreatedAt;
  });
  useEffect(() => {
    onNewRef.current = onNew;
  });

  useEffect(() => {
    if (!conversationId) return;

    async function poll() {
      // poll() only runs with a truthy conversationId (the effect returns early
      // when null) and only client-side (effects never run during SSR), so the
      // `!conversationId` and `typeof document === 'undefined'` guard branches
      // are dead defensive code.
      /* v8 ignore next 2 */
      if (!conversationId) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const cursor = cursorRef.current;
        const url =
          '/api/staff-chat/messages?conversationId=' +
          encodeURIComponent(conversationId) +
          (cursor ? '&after=' + encodeURIComponent(cursor) : '');
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as { rows: StaffPolledRow[] };
          if (data.rows && data.rows.length > 0) {
            onNewRef.current(data.rows);
          }
        }
      } catch {
        // swallow — defensive, don't crash on network errors
      }
    }

    const id = setInterval(() => {
      void poll();
    }, intervalMs);

    // Also poll immediately on tab becoming visible
    function handleVisibility() {
      /* v8 ignore next -- SSR guard: effects are client-only, document always defined */
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void poll();
      }
    }
    /* v8 ignore next -- SSR guard (dead client-side) */
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      clearInterval(id);
      /* v8 ignore next -- SSR guard (dead client-side) */
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [conversationId, intervalMs]); // latestCreatedAt/onNew live in refs — intentionally omitted
}
