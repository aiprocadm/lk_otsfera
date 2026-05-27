import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSession,
  createOrderDocumentMock,
  redirectMock
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  createOrderDocumentMock: vi.fn(),
  redirectMock: vi.fn(() => {
    throw new Error('REDIRECT');
  })
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: () => {
    throw new Error('NOTFOUND');
  }
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/uploads', () => ({
  createOrderDocument: createOrderDocumentMock
}));

import { POST as uploadPost } from '@/app/api/manager/documents/[id]/upload/route';

function managerSession(opts: { sub?: string; managedOrgIds?: string[] } = {}) {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    email: 'mgr@local',
    managedOrgIds: opts.managedOrgIds ?? ['org-a']
  };
}

function buildReq(opts: { file?: File | null; docType?: string }) {
  const fd = new FormData();
  if (opts.file !== null && opts.file !== undefined) {
    fd.set('file', opts.file);
  }
  if (opts.docType !== undefined) fd.set('docType', opts.docType);
  return new Request('https://app.local/api/manager/documents/ord-1/upload', {
    method: 'POST',
    body: fd
  });
}

const paramsP = { params: Promise.resolve({ id: 'ord-1' }) };

describe('POST /api/manager/documents/[id]/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue(managerSession());
  });

  it('redirects when caller is not a manager', async () => {
    getSession.mockResolvedValue({ sub: 'u-admin', role: 'admin' });
    await expect(
      uploadPost(
        buildReq({ file: new File(['x'], 'a.pdf', { type: 'application/pdf' }) }) as never,
        paramsP
      )
    ).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /login when managedOrgIds is undefined (loader did not run)', async () => {
    getSession.mockResolvedValue({ sub: 'u-mgr-1', role: 'manager' });
    await expect(
      uploadPost(
        buildReq({ file: new File(['x'], 'a.pdf', { type: 'application/pdf' }) }) as never,
        paramsP
      )
    ).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('returns 400 when no file field is present', async () => {
    const res = await uploadPost(buildReq({ docType: 'contract' }) as never, paramsP);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'no_file' });
    expect(createOrderDocumentMock).not.toHaveBeenCalled();
  });

  it('returns 201 with documentId on success', async () => {
    createOrderDocumentMock.mockResolvedValue({ ok: true, documentId: 'doc-1' });
    const res = await uploadPost(
      buildReq({
        file: new File(['x'], 'a.pdf', { type: 'application/pdf' }),
        docType: 'invoice'
      }) as never,
      paramsP
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; documentId: string };
    expect(body).toEqual({ ok: true, documentId: 'doc-1' });

    // Inspect the service args: file metadata threaded through correctly.
    expect(createOrderDocumentMock).toHaveBeenCalledTimes(1);
    const [, , args] = createOrderDocumentMock.mock.calls[0]!;
    expect(args).toMatchObject({
      orderId: 'ord-1',
      docType: 'invoice',
      file: { name: 'a.pdf', mimeType: 'application/pdf' }
    });
  });

  it('defaults docType to "other" when omitted', async () => {
    createOrderDocumentMock.mockResolvedValue({ ok: true, documentId: 'doc-2' });
    await uploadPost(
      buildReq({ file: new File(['x'], 'a.pdf', { type: 'application/pdf' }) }) as never,
      paramsP
    );
    const [, , args] = createOrderDocumentMock.mock.calls[0]!;
    expect(args.docType).toBe('other');
  });

  it('returns 403 for forbidden order', async () => {
    createOrderDocumentMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await uploadPost(
      buildReq({ file: new File(['x'], 'a.pdf', { type: 'application/pdf' }) }) as never,
      paramsP
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns 404 for missing order', async () => {
    createOrderDocumentMock.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await uploadPost(
      buildReq({ file: new File(['x'], 'a.pdf', { type: 'application/pdf' }) }) as never,
      paramsP
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns 413 for oversized file', async () => {
    createOrderDocumentMock.mockResolvedValue({ ok: false, error: 'too_large' });
    const res = await uploadPost(
      buildReq({ file: new File(['x'], 'big.pdf', { type: 'application/pdf' }) }) as never,
      paramsP
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'too_large' });
  });

  it('returns 415 for unsupported MIME type', async () => {
    createOrderDocumentMock.mockResolvedValue({ ok: false, error: 'invalid_mime' });
    const res = await uploadPost(
      buildReq({
        file: new File(['x'], 'virus.exe', { type: 'application/x-msdownload' })
      }) as never,
      paramsP
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('returns 500 when storage upload fails', async () => {
    createOrderDocumentMock.mockResolvedValue({ ok: false, error: 'storage' });
    const res = await uploadPost(
      buildReq({ file: new File(['x'], 'a.pdf', { type: 'application/pdf' }) }) as never,
      paramsP
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'storage' });
  });
});
