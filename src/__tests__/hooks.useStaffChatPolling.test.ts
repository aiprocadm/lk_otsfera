// @vitest-environment jsdom
/**
 * Renders the REAL useStaffChatPolling hook (not a re-implemented copy) via
 * @testing-library/react's renderHook, mirroring the "useThreadPolling — real
 * hook lifecycle" suite in cov.hooks.test.tsx (chat domain sibling). Exercises
 * the effect, interval, visibility listener, cursor/onNew refs and cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStaffChatPolling, type StaffPolledRow } from '@/hooks/useStaffChatPolling';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body)
  } as unknown as Response;
}

function makeRow(id: string, createdAt: string): StaffPolledRow {
  return {
    id,
    authorId: 'a1',
    authorName: 'Alice',
    body: 'hello',
    hasAttachment: false,
    attachmentName: null,
    scanStatus: 'none',
    createdAt,
    reactions: []
  };
}

/** Set jsdom document.visibilityState (it's a read-only getter by default). */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state
  });
}

describe('useStaffChatPolling — real hook lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('no-op early return when conversationId is null (no interval, no fetch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    renderHook(() => useStaffChatPolling(null, null, onNew, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onNew).not.toHaveBeenCalled();
  });

  it('polls on the interval, builds the after= URL from the cursor, and fires onNew with rows tagged by the polled conversationId', async () => {
    const rows = [makeRow('m1', '2024-01-01T12:00:00Z')];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    renderHook(() => useStaffChatPolling('conv-abc', '2024-01-01T11:00:00Z', onNew, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('conversationId=conv-abc');
    expect(url).toContain('after=2024-01-01T11%3A00%3A00Z');
    // The batch is tagged with the conversation it was polled for so the
    // consumer can drop a stale in-flight response after a switch.
    expect(onNew).toHaveBeenCalledWith(rows, 'conv-abc');
  });

  it('omits after= when the cursor is null, and does NOT fire onNew on empty rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    renderHook(() => useStaffChatPolling('conv-xyz', null, onNew, 1000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('conversationId=conv-xyz');
    expect(url).not.toContain('after=');
    expect(onNew).not.toHaveBeenCalled();
  });

  it('advances the cursor across renders without recreating the interval', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    const { rerender } = renderHook(
      ({ cursor }: { cursor: string | null }) => useStaffChatPolling('conv-abc', cursor, onNew, 1000),
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
      ({ cb }: { cb: (r: StaffPolledRow[]) => void }) => useStaffChatPolling('conv-abc', null, cb, 1000),
      { initialProps: { cb: onNewA as (r: StaffPolledRow[]) => void } }
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
    renderHook(() => useStaffChatPolling('conv-abc', null, onNew, 1000));

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
    renderHook(() => useStaffChatPolling('conv-abc', null, onNew, 100000));

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

    renderHook(() => useStaffChatPolling('conv-abc', null, onNew, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNew).not.toHaveBeenCalled();
  });

  it('swallows network errors (catch branch) without firing onNew or throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const onNew = vi.fn();

    renderHook(() => useStaffChatPolling('conv-abc', null, onNew, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(onNew).not.toHaveBeenCalled();
  });

  it('uses the default 7000ms interval when intervalMs is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const onNew = vi.fn();

    renderHook(() => useStaffChatPolling('conv-abc', null, onNew));

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

    const { unmount } = renderHook(() => useStaffChatPolling('conv-abc', null, onNew, 1000));

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

describe('useStaffChatPolling — module exports', () => {
  it('exports useStaffChatPolling as a function', async () => {
    const mod = await import('@/hooks/useStaffChatPolling');
    expect(typeof mod.useStaffChatPolling).toBe('function');
  });
});
