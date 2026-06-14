import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));
vi.mock('@/lib/storage/supabase', () => ({
  documentBucket: 'documents',
  supabaseAdmin: { storage: { from: () => ({ upload: uploadMock }) } }
}));

import { fetchAndStore1CDocument } from '@/lib/services/oneCSync/document-fetch';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => uploadMock.mockReset());

describe('fetchAndStore1CDocument (DOC-03)', () => {
  it('fetches the URL and uploads to Supabase, returning a storage key (not a URL)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    uploadMock.mockResolvedValue({ error: null });
    const key = await fetchAndStore1CDocument({ url: 'https://1c/x.pdf', orderId: 'ord1', name: 'Договор.pdf', mimeType: 'application/pdf' });
    expect(key).toMatch(/^orders\/ord1\/1c\//);
    expect(key).not.toContain('https://');
    expect(uploadMock).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), expect.objectContaining({ contentType: 'application/pdf' }));
  });

  it('returns null on a 404 without retrying (skips, no throw)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    vi.stubGlobal('fetch', fetchMock);
    const key = await fetchAndStore1CDocument({ url: 'https://1c/missing', orderId: 'o', name: 'n', mimeType: 'application/pdf' });
    expect(key).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // 404 is not transient → no retry
  });

  it('returns null when the Supabase upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    uploadMock.mockResolvedValue({ error: { message: 'boom' } });
    const key = await fetchAndStore1CDocument({ url: 'https://1c/x', orderId: 'o', name: 'n', mimeType: 'application/pdf' });
    expect(key).toBeNull();
  });
});
