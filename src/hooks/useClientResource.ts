'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pure fetch logic for client-side reads. Extracted from the hook so it can be
 * unit-tested without a React lifecycle (vitest runs in node, no jsdom →
 * renderHook is unavailable). Mirrors buildFetchAction from useFetchSubmit.
 *
 * Resolves to { ok: true, data } on a successful 2xx + JSON parse, or
 * { ok: false } on !res.ok / network error / JSON error. Never throws.
 */
export async function fetchResource<T>(
  url: string,
  select?: (raw: unknown) => T
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false };
    const raw = (await res.json()) as unknown;
    const data = select ? select(raw) : (raw as T);
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

export type ResourceState<T> = {
  data: T | null;
  loading: boolean;
  error: boolean;
  refetch: () => void;
};

export type ResourceOptions<T> = {
  /** default true; false → не грузить (ленивый/гейтированный режим) */
  enabled?: boolean;
  /** если задан — visibility-gated polling каждые intervalMs мс */
  intervalMs?: number;
  /** опц. маппер raw JSON → T */
  select?: (raw: unknown) => T;
};

/**
 * Generic client-side read hook (sibling к useThreadPolling).
 * Грузит url на mount (если enabled), отдаёт { data, loading, error, refetch }.
 * loading=true только во время ПЕРВОЙ загрузки (не во время фонового refetch/poll).
 * intervalMs → фоновый поллинг, который не срабатывает на скрытой вкладке и
 * немедленно догружает при возврате видимости.
 */
export function useClientResource<T>(url: string, options?: ResourceOptions<T>): ResourceState<T> {
  const { enabled = true, intervalMs, select } = options ?? {};

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // select в ref — чтобы inline-функция, меняющая identity каждый render,
  // не рвала эффекты (тот же приём, что в useThreadPolling).
  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const firstLoadDone = useRef(false);

  const load = useCallback(async () => {
    if (!firstLoadDone.current) setLoading(true);
    const result = await fetchResource<T>(url, selectRef.current);
    if (!mountedRef.current) return;
    firstLoadDone.current = true;
    setLoading(false);
    if (result.ok) {
      setData(result.data);
      setError(false);
    } else {
      setError(true);
    }
  }, [url]);

  // Initial / enabled-triggered load
  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  // Optional visibility-gated polling
  useEffect(() => {
    if (!enabled || !intervalMs) return;
    const id = setInterval(() => {
      // Effects run client-side only, so `typeof document === 'undefined'` (SSR) is
      // dead; the visibility logic itself is tested.
      /* v8 ignore next */
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void load();
    }, intervalMs);

    function onVisible() {
      /* v8 ignore next -- SSR guard (dead client-side) */
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void load();
      }
    }
    /* v8 ignore next -- SSR guard (dead client-side) */
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    return () => {
      clearInterval(id);
      /* v8 ignore next -- SSR guard (dead client-side) */
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [enabled, intervalMs, load]);

  // Сигнатура refetch остаётся () => void: вызывающие не ждут промис,
  // ошибки load обрабатывает сам (setError) — оборачиваем в void.
  return { data, loading, error, refetch: () => void load() };
}
