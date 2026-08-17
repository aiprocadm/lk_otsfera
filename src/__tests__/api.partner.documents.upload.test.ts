import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, createPartnerDocumentMock, redirectMock } = vi.hoisted(() => ({
  getSession: vi.fn(),
  createPartnerDocumentMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: () => {
    throw new Error('NOTFOUND');
  },
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/partner/documentUpload', () => ({
  createPartnerDocument: createPartnerDocumentMock,
}));

import { POST as uploadPost } from '@/app/api/partner/documents/upload/route';

function partnerSession(opts: { partnerId?: string | null } = {}) {
  return {
    sub: 'u-ptr-1',
    role: 'partner',
    email: 'ptr@local',
    partnerId: opts.partnerId === undefined ? 'ptr-1' : opts.partnerId,
  };
}

function buildReq(opts: { file?: File | null; orderId?: string; docType?: string }) {
  const fd = new FormData();
  if (opts.file !== null && opts.file !== undefined) {
    fd.set('file', opts.file);
  }
  if (opts.orderId !== undefined) fd.set('orderId', opts.orderId);
  if (opts.docType !== undefined) fd.set('docType', opts.docType);
  return new Request('https://app.local/api/partner/documents/upload', {
    method: 'POST',
    body: fd,
  });
}

const pdf = () => new File(['x'], 'a.pdf', { type: 'application/pdf' });

describe('POST /api/partner/documents/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue(partnerSession());
  });

  it('redirects to /login when there is no session', async () => {
    getSession.mockResolvedValue(null);
    await expect(uploadPost(buildReq({ file: pdf(), orderId: 'ord-1' }) as never)).rejects.toThrow(
      'REDIRECT'
    );
    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(createPartnerDocumentMock).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden when caller is not a partner', async () => {
    getSession.mockResolvedValue({ sub: 'u-mgr', role: 'manager' });
    await expect(uploadPost(buildReq({ file: pdf(), orderId: 'ord-1' }) as never)).rejects.toThrow(
      'REDIRECT'
    );
    expect(redirectMock).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden when the partner session has no partnerId', async () => {
    getSession.mockResolvedValue(partnerSession({ partnerId: null }));
    await expect(uploadPost(buildReq({ file: pdf(), orderId: 'ord-1' }) as never)).rejects.toThrow(
      'REDIRECT'
    );
    expect(redirectMock).toHaveBeenCalledWith('/forbidden');
  });

  it('returns 400 when formData() parsing fails (non-multipart body)', async () => {
    const badReq = new Request('https://app.local/api/partner/documents/upload', {
      method: 'POST',
      body: 'NOT MULTIPART',
      headers: { 'content-type': 'application/json' },
    });
    const res = await uploadPost(badReq as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'no_file' });
    expect(createPartnerDocumentMock).not.toHaveBeenCalled();
  });

  it('returns 400 validation when orderId is missing', async () => {
    const res = await uploadPost(buildReq({ file: pdf() }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'validation' });
    expect(createPartnerDocumentMock).not.toHaveBeenCalled();
  });

  it('returns 400 when no file field is present', async () => {
    const res = await uploadPost(buildReq({ orderId: 'ord-1', docType: 'contract' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'no_file' });
    expect(createPartnerDocumentMock).not.toHaveBeenCalled();
  });

  it('returns 201 with documentId on success and threads args through', async () => {
    createPartnerDocumentMock.mockResolvedValue({ ok: true, documentId: 'doc-1' });
    const res = await uploadPost(
      buildReq({ file: pdf(), orderId: 'ord-1', docType: 'invoice' }) as never
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; documentId: string };
    expect(body).toEqual({ ok: true, documentId: 'doc-1' });

    expect(createPartnerDocumentMock).toHaveBeenCalledTimes(1);
    const [, session, args] = createPartnerDocumentMock.mock.calls[0]!;
    expect(session.partnerId).toBe('ptr-1');
    expect(args).toMatchObject({
      orderId: 'ord-1',
      docType: 'invoice',
      file: { name: 'a.pdf', mimeType: 'application/pdf' },
    });
  });

  it('defaults docType to "other" when omitted', async () => {
    createPartnerDocumentMock.mockResolvedValue({ ok: true, documentId: 'doc-2' });
    await uploadPost(buildReq({ file: pdf(), orderId: 'ord-1' }) as never);
    const [, , args] = createPartnerDocumentMock.mock.calls[0]!;
    expect(args.docType).toBe('other');
  });

  it('returns 403 for forbidden', async () => {
    createPartnerDocumentMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await uploadPost(buildReq({ file: pdf(), orderId: 'ord-1' }) as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns 404 for an order outside the portfolio', async () => {
    createPartnerDocumentMock.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await uploadPost(buildReq({ file: pdf(), orderId: 'ord-x' }) as never);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns 413 for oversized file', async () => {
    createPartnerDocumentMock.mockResolvedValue({ ok: false, error: 'too_large' });
    const res = await uploadPost(buildReq({ file: pdf(), orderId: 'ord-1' }) as never);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: 'too_large' });
  });

  it('returns 415 for unsupported MIME type', async () => {
    createPartnerDocumentMock.mockResolvedValue({ ok: false, error: 'invalid_mime' });
    const res = await uploadPost(
      buildReq({
        file: new File(['x'], 'virus.exe', { type: 'application/x-msdownload' }),
        orderId: 'ord-1',
      }) as never
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('returns 500 when storage upload fails', async () => {
    createPartnerDocumentMock.mockResolvedValue({ ok: false, error: 'storage' });
    const res = await uploadPost(buildReq({ file: pdf(), orderId: 'ord-1' }) as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'storage' });
  });
});
