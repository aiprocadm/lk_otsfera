'use client';

import { useEffect } from 'react';
import { clientLog } from '@/lib/logging/client';

export function PwaInstaller() {
  useEffect(() => {
    // SSR guard: effects only run client-side (React never invokes useEffect
    // during server rendering), so `typeof window === 'undefined'` is dead code
    // here — same pattern as useThreadPolling.ts/useClientResource.ts.
    /* v8 ignore next -- SSR guard (dead client-side) */
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
      clientLog.warn('[pwa] service worker registration failed', err);
    });
  }, []);
  return null;
}
