// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Phase-2 coverage — the React-lifecycle branches of the client hooks that the
 * existing node-env mirror tests can't reach:
 *
 *  - hooks.useClientResource.test.ts only exercises the extracted pure
 *    `fetchResource` + an export smoke-test; the useState/useEffect wiring
 *    (loading gate, mount guard, error branch, visibility-gated polling) needs
 *    a live render harness.
 *  - hooks.useThreadPolling.test.ts tests a *re-implemented copy* of the poll
 *    function; here we render the REAL hook via renderHook so its effect,
 *    interval, visibility listener, cursor/onNew refs and cleanup are covered.
 *
 * Harness mirrors cov.useformaction.test.tsx (jsdom + @testing-library
 * renderHook/act). Timers are faked only in the polling suites and reset in
 * afterEach.
 */

import { useClientResource } from '@/hooks/useClientResource';
import { useThreadPolling, type PolledRow } from '@/hooks/useThreadPolling';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeRow(id: string, createdAt: string): PolledRow {
  return {
    id,
    authorId: 'a1',
    body: 'hello',
    hasAttachment: false,
    authorName: 'Alice',
    createdAt,
  };
}

/** Set jsdom document.visibilityState (it's a read-only getter by default). */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ===========================================================================
// useClientResource
// ===========================================================================

describe('useClientResource — lifecycle branches', () => {
  it('loads on mount: loading→loaded, sets data, error stays false (no options)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ count: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    // No options at all → exercises `options ?? {}` nullish default + no select.
    const { result } = renderHook(() => useClientResource<{ count: number }>('/api/x'));

    // loading gate flipped true synchronously in the effect (first load).
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ count: 3 });
    expect(result.current.error).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/x');
  });

  it('applies select mapper to the raw json', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ count: 9 })));

    const { result } = renderHook(() =>
      useClientResource<number>('/api/x', { select: (raw) => (raw as { count: number }).count })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(9);
    expect(result.current.error).toBe(false);
  });

  it('sets error=true (and leaves data null) when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, /* ok */ false)));

    const { result } = renderHook(() => useClientResource('/api/x'));

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('does NOT load when enabled:false, and loads once flipped to enabled:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ v: 1 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useClientResource<{ v: number }>('/api/x', { enabled }),
      { initialProps: { enabled: false } }
    );

    // enabled:false → both effects early-return, no fetch.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetch() triggers another load without re-entering the loading state', async () => {
    let n = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      n += 1;
      return Promise.resolve(jsonResponse({ n }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useClientResource<{ n: number }>('/api/x'));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    // firstLoadDone is now true → refetch skips the setLoading(true) branch.
    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
    expect(result.current.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bails out (mount guard) when the component unmounts before fetch resolves', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((res) => {
          resolveFetch = res;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useClientResource<{ v: number }>('/api/x'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Unmount while the fetch is still pending → mountedRef becomes false.
    unmount();

    // Now resolve; the `if (!mountedRef.current) return;` branch must swallow it
    // (no state update after unmount, no warning/throw).
    await act(async () => {
      resolveFetch(jsonResponse({ v: 42 }));
      await Promise.resolve();
    });

    // State captured at unmount is still the initial (null) — never updated.
    expect(result.current.data).toBeNull();
  });

  describe('visibility-gated polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      setVisibility('visible');
    });
    afterEach(() => {
      vi.useRealTimers();
      setVisibility('visible');
    });

    it('polls on the interval while visible, and skips ticks while hidden', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tick: true }));
      vi.stubGlobal('fetch', fetchMock);

      const { unmount } = renderHook(() => useClientResource('/api/poll', { intervalMs: 1000 }));

      // Initial mount load.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Visible tick → polls.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Hidden → the interval callback hits the visibility guard and returns early.
      setVisibility('hidden');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      unmount();
    });

    it('polls immediately when the tab becomes visible again', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tick: true }));
      vi.stubGlobal('fetch', fetchMock);

      const { unmount } = renderHook(() => useClientResource('/api/poll', { intervalMs: 5000 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const afterMount = fetchMock.mock.calls.length; // initial load

      // visibilitychange while visible → onVisible load branch.
      setVisibility('visible');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      expect(fetchMock.mock.calls.length).toBe(afterMount + 1);

      // visibilitychange while hidden → onVisible guard skips (no extra fetch).
      setVisibility('hidden');
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      expect(fetchMock.mock.calls.length).toBe(afterMount + 1);

      unmount();
    });

    it('cleans up the interval + listener on unmount (no polling after)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      const { unmount } = renderHook(() => useClientResource('/api/poll', { intervalMs: 1000 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const before = fetchMock.mock.calls.length;

      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(fetchMock.mock.calls.length).toBe(before);

      // Listener removed too: a post-unmount visibilitychange does nothing.
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchMock.mock.calls.length).toBe(before);
    });
  });
});

// ===========================================================================
// useThreadPolling  (render the REAL hook, not a re-implementation)
// ===========================================================================

describe('useThreadPolling — real hook lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('no-op early return when threadId is null (no interval, no fetch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    renderHook(() => useThreadPolling(null, null, onNew, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onNew).not.toHaveBeenCalled();
  });

  it('polls on the interval, builds the after= URL from the cursor, and fires onNew on new rows', async () => {
    const rows = [makeRow('m1', '2024-01-01T12:00:00Z')];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    renderHook(() => useThreadPolling('thread-abc', '2024-01-01T11:00:00Z', onNew, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('threadId=thread-abc');
    expect(url).toContain('after=2024-01-01T11%3A00%3A00Z');
    expect(onNew).toHaveBeenCalledWith(rows);
  });

  it('omits after= when the cursor is null, and does NOT fire onNew on empty rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    renderHook(() => useThreadPolling('thread-xyz', null, onNew, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('threadId=thread-xyz');
    expect(url).not.toContain('after=');
    expect(onNew).not.toHaveBeenCalled();
  });

  it('advances the cursor across renders without recreating the interval', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    const { rerender } = renderHook(
      ({ cursor }: { cursor: string | null }) =>
        useThreadPolling('thread-abc', cursor, onNew, 1000),
      { initialProps: { cursor: null as string | null } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock.mock.calls[0][0] as string).not.toContain('after=');

    // New cursor lands in cursorRef (sync effect) — same interval keeps ticking.
    rerender({ cursor: '2024-02-02T00:00:00Z' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain('after=2024-02-02T00%3A00%3A00Z');
  });

  it('swaps the onNew callback via ref without tearing down the interval', async () => {
    const rows = [makeRow('m9', '2024-03-03T00:00:00Z')];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows }));
    vi.stubGlobal('fetch', fetchMock);

    const onNewA = vi.fn();
    const onNewB = vi.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: (r: PolledRow[]) => void }) => useThreadPolling('thread-abc', null, cb, 1000),
      { initialProps: { cb: onNewA as (r: PolledRow[]) => void } }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onNewA).toHaveBeenCalledTimes(1);

    rerender({ cb: onNewB });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(onNewB).toHaveBeenCalledTimes(1);
    // A not called again — the ref swap took effect.
    expect(onNewA).toHaveBeenCalledTimes(1);
  });

  it('skips the poll body when the tab is hidden', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    setVisibility('hidden');
    renderHook(() => useThreadPolling('thread-abc', null, onNew, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('polls immediately when the tab becomes visible, and skips the handler while hidden', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    setVisibility('hidden');
    renderHook(() => useThreadPolling('thread-abc', null, onNew, 100000));

    // hidden visibilitychange → handler guard skips.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // visible visibilitychange → immediate poll.
    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fire onNew when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, /* ok */ false));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    renderHook(() => useThreadPolling('thread-abc', null, onNew, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNew).not.toHaveBeenCalled();
  });

  it('swallows network errors (catch branch) without firing onNew or throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const onNew = vi.fn();

    renderHook(() => useThreadPolling('thread-abc', null, onNew, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(onNew).not.toHaveBeenCalled();
  });

  it('uses the default 7000ms interval when intervalMs is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    renderHook(() => useThreadPolling('thread-abc', null, onNew));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6999);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the interval + listener on unmount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    const { unmount } = renderHook(() => useThreadPolling('thread-abc', null, onNew, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const before = fetchMock.mock.calls.length;

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock.mock.calls.length).toBe(before);

    // Listener gone too.
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
