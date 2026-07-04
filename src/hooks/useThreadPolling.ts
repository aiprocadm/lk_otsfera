'use client';
import { useEffect, useRef } from 'react';

export type PolledRow = {
  id: string;
  authorId: string;
  body: string;
  hasAttachment: boolean;
  authorName: string;
  createdAt: string;
};

/**
 * Polls GET /api/messages?threadId=&after=<latest createdAt> every `intervalMs`
 * while threadId is set and document.visibilityState === 'visible'.
 * Calls onNew with rows newer than the latest seen.
 *
 * Keeps latestCreatedAt and onNew in refs so the useEffect only depends on
 * [threadId, intervalMs] — the interval is NOT torn down/recreated on each new
 * message.
 */
export function useThreadPolling(
  threadId: string | null,
  latestCreatedAt: string | null,
  onNew: (rows: PolledRow[]) => void,
  intervalMs = 7000
): void {
  const cursorRef = useRef<string | null>(latestCreatedAt);
  const onNewRef = useRef<(rows: PolledRow[]) => void>(onNew);

  // Keep refs in sync each render without recreating the interval
  useEffect(() => {
    cursorRef.current = latestCreatedAt;
  });
  useEffect(() => {
    onNewRef.current = onNew;
  });

  useEffect(() => {
    if (!threadId) return;

    async function poll() {
      // poll() only runs with a truthy threadId (the effect returns early when null)
      // and only client-side (effects never run during SSR), so the `!threadId` and
      // `typeof document === 'undefined'` guard branches are dead defensive code.
      /* v8 ignore next 2 */
      if (!threadId) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const cursor = cursorRef.current;
        const url =
          '/api/messages?threadId=' +
          encodeURIComponent(threadId) +
          (cursor ? '&after=' + encodeURIComponent(cursor) : '');
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as { rows: PolledRow[] };
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
  }, [threadId, intervalMs]); // latestCreatedAt/onNew live in refs — intentionally omitted
}
