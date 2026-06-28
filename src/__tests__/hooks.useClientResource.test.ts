/**
 * Unit tests for useClientResource.
 *
 * Like useThreadPolling, the project runs vitest in `node` env (no jsdom,
 * no @testing-library/react) so renderHook() is unavailable. We test the
 * extracted pure `fetchResource` logic directly with stubbed global.fetch,
 * plus a smoke-test that the hook is exported. The React lifecycle wiring is
 * covered by typecheck + the migration component tests + manual browser check.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchResource } from '@/hooks/useClientResource';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchResource', () => {
  it('returns ok:true with parsed json on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 5 })
    } as unknown as Response));

    const result = await fetchResource('/api/messages/unread');
    expect(result).toEqual({ ok: true, data: { count: 5 } });
  });

  it('applies select to map the raw response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 7 })
    } as unknown as Response));

    const result = await fetchResource<number>(
      '/api/messages/unread',
      (d) => (d as { count: number }).count
    );
    expect(result).toEqual({ ok: true, data: 7 });
  });

  it('returns ok:false when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    const result = await fetchResource('/api/x');
    expect(result).toEqual({ ok: false });
  });

  it('returns ok:false and does NOT throw on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(fetchResource('/api/x')).resolves.toEqual({ ok: false });
  });

  it('calls fetch with the given url', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([])
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);

    await fetchResource('/api/documents');
    expect(mockFetch).toHaveBeenCalledWith('/api/documents');
  });
});

describe('useClientResource — module exports', () => {
  it('exports useClientResource as a function', async () => {
    const mod = await import('@/hooks/useClientResource');
    expect(typeof mod.useClientResource).toBe('function');
  });
});
