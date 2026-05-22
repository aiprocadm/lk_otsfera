'use client';

import { useEffect } from 'react';

export function PwaInstaller() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
      console.warn('[pwa] service worker registration failed', err);
    });
  }, []);
  return null;
}
