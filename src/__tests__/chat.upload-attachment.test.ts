import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadAttachment } from '@/lib/chat/upload-attachment';

// Mock global.fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

describe('uploadAttachment', () => {
  function makeFile(name = 'doc.pdf', size = 1024) {
    return new File(['x'.repeat(size)], name, { type: 'application/pdf' });
  }

  it('returns attachmentPath on 200 ok:true response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, attachmentPath: 'chat/uploads/abc.pdf' })
    });
    const result = await uploadAttachment(makeFile(), 'order-1');
    expect(result).toBe('chat/uploads/abc.pdf');
  });

  it('returns null on a non-ok HTTP response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 413 });
    const result = await uploadAttachment(makeFile(), 'order-1');
    expect(result).toBeNull();
  });

  it('returns null when response body has ok:false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'invalid_mime' })
    });
    const result = await uploadAttachment(makeFile(), 'order-1');
    expect(result).toBeNull();
  });

  it('returns null when response JSON is malformed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); }
    });
    const result = await uploadAttachment(makeFile(), 'order-1');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const result = await uploadAttachment(makeFile(), 'o1');
    expect(result).toBeNull();
  });

  it('includes file, orderId in FormData — no side when omitted', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, attachmentPath: 'path/x' })
    });
    const file = makeFile('test.pdf');
    await uploadAttachment(file, 'order-42');

    const [, opts] = fetchMock.mock.calls[0] as [string, { body: FormData }];
    const fd = opts.body as FormData;
    expect(fd.get('file')).toBe(file);
    expect(fd.get('orderId')).toBe('order-42');
    expect(fd.get('side')).toBeNull();
  });

  it('includes side in FormData when provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, attachmentPath: 'path/y' })
    });
    const file = makeFile('test.docx');
    await uploadAttachment(file, 'order-99', 'partner');

    const [, opts] = fetchMock.mock.calls[0] as [string, { body: FormData }];
    const fd = opts.body as FormData;
    expect(fd.get('side')).toBe('partner');
  });

  it('uses POST method and /api/messages/attachment endpoint', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, attachmentPath: 'p' })
    });
    await uploadAttachment(makeFile(), 'ord');
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/messages/attachment');
    expect(opts.method).toBe('POST');
  });
});
