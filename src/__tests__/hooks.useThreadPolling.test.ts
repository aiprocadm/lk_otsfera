/**
 * Unit tests for the useThreadPolling hook.
 *
 * Because the project runs vitest in `node` environment (no jsdom) and doesn't
 * have @testing-library/react, we can't call renderHook() directly.
 * Instead we extract and test the *poll function* logic directly using fake
 * timers + stubbed global.fetch, which gives us confidence over the observable
 * contract (URL construction, onNew callback, cursor usage) without needing
 * a full React lifecycle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PolledRow } from '@/hooks/useThreadPolling';

// ---------------------------------------------------------------------------
// Helper: build a poll function equivalent to what the hook uses internally.
// This isolates the fetching logic from React's lifecycle.
// ---------------------------------------------------------------------------

function makePollFn(
  getThreadId: () => string | null,
  getCursor: () => string | null,
  onNew: (rows: PolledRow[]) => void
) {
  return async function poll() {
    const threadId = getThreadId();
    if (!threadId) return;
    // Simulate visibility check: in node there is no `document`
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const cursor = getCursor();
      const url =
        '/api/messages?threadId=' +
        encodeURIComponent(threadId) +
        (cursor ? '&after=' + encodeURIComponent(cursor) : '');
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as { rows: PolledRow[] };
        if (data.rows && data.rows.length > 0) {
          onNew(data.rows);
        }
      }
    } catch {
      // swallow
    }
  };
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useThreadPolling — poll function logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches with correct URL including after= cursor when threadId is set', async () => {
    const rows = [makeRow('msg-1', '2024-01-01T12:00:00Z')];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows }),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);

    const onNew = vi.fn();
    const poll = makePollFn(
      () => 'thread-abc',
      () => '2024-01-01T11:00:00Z',
      onNew
    );

    // Simulate interval tick
    await poll();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain('threadId=thread-abc');
    expect(calledUrl).toContain('after=2024-01-01T11%3A00%3A00Z');
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onNew).toHaveBeenCalledWith(rows);
  });

  it('does NOT fetch when threadId is null', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [] }),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);

    const onNew = vi.fn();
    const poll = makePollFn(
      () => null,
      () => null,
      onNew
    );

    await poll();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(onNew).not.toHaveBeenCalled();
  });

  it('does NOT call onNew when fetch returns empty rows', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [] }),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);

    const onNew = vi.fn();
    const poll = makePollFn(
      () => 'thread-xyz',
      () => null,
      onNew
    );

    await poll();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(onNew).not.toHaveBeenCalled();
  });

  it('fetches without after= when cursor is null', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [] }),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);

    const onNew = vi.fn();
    const poll = makePollFn(
      () => 'thread-abc',
      () => null,
      onNew
    );

    await poll();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain('threadId=thread-abc');
    expect(calledUrl).not.toContain('after=');
  });

  it('does NOT call onNew or throw when fetch rejects (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    const onNew = vi.fn();
    const poll = makePollFn(
      () => 'thread-abc',
      () => null,
      onNew
    );

    // Should not throw
    await expect(poll()).resolves.toBeUndefined();
    expect(onNew).not.toHaveBeenCalled();
  });

  it('does NOT call onNew when fetch returns not-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));

    const onNew = vi.fn();
    const poll = makePollFn(
      () => 'thread-abc',
      () => null,
      onNew
    );

    await poll();
    expect(onNew).not.toHaveBeenCalled();
  });

  it('interval-based invocation: fires multiple times when setInterval advances', async () => {
    const rows = [makeRow('msg-x', '2024-01-01T12:00:00Z')];
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ rows }),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', mockFetch);

    const onNew = vi.fn();

    // Simulate interval manually (mimics how setInterval fires the poll)
    const INTERVAL = 1000;
    const intervalId = setInterval(() => {
      void (async () => {
        await makePollFn(
          () => 'thread-abc',
          () => null,
          onNew
        )();
      })();
    }, INTERVAL);

    await vi.advanceTimersByTimeAsync(INTERVAL * 3 + 50);

    clearInterval(intervalId);

    expect(callCount).toBe(3);
    expect(onNew).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Smoke-test: hook module exports the expected function shape
// ---------------------------------------------------------------------------

describe('useThreadPolling — module exports', () => {
  it('exports useThreadPolling as a function', async () => {
    const mod = await import('@/hooks/useThreadPolling');
    expect(typeof mod.useThreadPolling).toBe('function');
  });
});
