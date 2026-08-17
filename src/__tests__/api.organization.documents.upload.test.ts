import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, createOrganizationDocumentMock, redirectMock } = vi.hoisted(() => ({
  getSession: vi.fn(),
  createOrganizationDocumentMock: vi.fn(),
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
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/services/organization/documentUpload', () => ({
  createOrganizationDocument: createOrganizationDocumentMock,
}));

import { POST as uploadPost } from '@/app/api/organization/documents/upload/route';
import { notFoundIfDisabled } from '@/lib/featureFlags';

function orgSession(opts: { memberships?: Array<{ organizationId: string; isActive: boolean }> } = {}) {
  return {
    sub: 'u-org-1',
    role: 'organization',
    email: 'org@local',
    organizationMemberships: opts.memberships ?? [{ organizationId: 'org-a', isActive: true }],
  };
}

function buildReq(opts: {
  file?: File | null;
  organizationId?: string;
  orderId?: string;
  docType?: string;
}) {
  const fd = new FormData();
  if (opts.file !== null && opts.file !== undefined) {
    fd.set('file', opts.file);
  }
  if (opts.organizationId !== undefined) fd.set('organizationId', opts.organizationId);
  if (opts.orderId !== undefined) fd.set('orderId', opts.orderId);
  if (opts.docType !== undefined) fd.set('docType', opts.docType);
  return new Request('https://app.local/api/organization/documents/upload', {
    method: 'POST',
    body: fd,
  });
}

const pdf = () => new File(['x'], 'a.pdf', { type: 'application/pdf' });

describe('POST /api/organization/documents/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue(orgSession());
    vi.mocked(notFoundIfDisabled).mockReturnValue(undefined as never);
  });

  it('returns 404 when the organization cabinet flag is disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(
      new Response('Not Found', { status: 404 }) as never
    );
    const res = await uploadPost(
      buildReq({ file: pdf(), organizationId: 'org-a', orderId: 'ord-1' }) as never
    );
    expect(res.status).toBe(404);
    expect(createOrganizationDocumentMock).not.toHaveBeenCalled();
  });

  it('redirects to /login when there is no session', async () => {
    getSession.mockResolvedValue(null);
    await expect(
      uploadPost(buildReq({ file: pdf(), organizationId: 'org-a' }) as never)
    ).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('redirects to /forbidden when caller is not an organization user', async () => {
    getSession.mockResolvedValue({ sub: 'u-ptr', role: 'partner', partnerId: 'ptr-1' });
    await expect(
      uploadPost(buildReq({ file: pdf(), organizationId: 'org-a' }) as never)
    ).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/forbidden');
  });

  it('redirects to /forbidden when all memberships are inactive', async () => {
    getSession.mockResolvedValue(
      orgSession({ memberships: [{ organizationId: 'org-a', isActive: false }] })
    );
    await expect(
      uploadPost(buildReq({ file: pdf(), organizationId: 'org-a' }) as never)
    ).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/forbidden');
  });

  it('returns 400 when formData() parsing fails (non-multipart body)', async () => {
    const badReq = new Request('https://app.local/api/organization/documents/upload', {
      method: 'POST',
      body: 'NOT MULTIPART',
      headers: { 'content-type': 'application/json' },
    });
    const res = await uploadPost(badReq as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'no_file' });
    expect(createOrganizationDocumentMock).not.toHaveBeenCalled();
  });

  it('returns 400 validation when organizationId is missing', async () => {
    const res = await uploadPost(buildReq({ file: pdf(), orderId: 'ord-1' }) as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'validation' });
    expect(createOrganizationDocumentMock).not.toHaveBeenCalled();
  });

  it('returns 400 when no file field is present', async () => {
    const res = await uploadPost(buildReq({ organizationId: 'org-a', orderId: 'ord-1' }) as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'no_file' });
    expect(createOrganizationDocumentMock).not.toHaveBeenCalled();
  });

  it('returns 201 on success and threads args through (order branch)', async () => {
    createOrganizationDocumentMock.mockResolvedValue({ ok: true, documentId: 'doc-1' });
    const res = await uploadPost(
      buildReq({
        file: pdf(),
        organizationId: 'org-a',
        orderId: 'ord-1',
        docType: 'invoice',
      }) as never
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, documentId: 'doc-1' });

    expect(createOrganizationDocumentMock).toHaveBeenCalledTimes(1);
    const [, session, args] = createOrganizationDocumentMock.mock.calls[0]!;
    expect(session.sub).toBe('u-org-1');
    expect(args).toMatchObject({
      organizationId: 'org-a',
      orderId: 'ord-1',
      docType: 'invoice',
      file: { name: 'a.pdf', mimeType: 'application/pdf' },
    });
  });

  it('passes orderId: null when the field is absent (order-less branch)', async () => {
    createOrganizationDocumentMock.mockResolvedValue({ ok: true, documentId: 'doc-2' });
    await uploadPost(buildReq({ file: pdf(), organizationId: 'org-a' }) as never);
    const [, , args] = createOrganizationDocumentMock.mock.calls[0]!;
    expect(args.orderId).toBeNull();
    expect(args.docType).toBe('other');
  });

  it('returns 403 when the user is not a member of the target organization', async () => {
    createOrganizationDocumentMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await uploadPost(
      buildReq({ file: pdf(), organizationId: 'org-b', orderId: 'ord-1' }) as never
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns 404 for a missing order/company', async () => {
    createOrganizationDocumentMock.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await uploadPost(
      buildReq({ file: pdf(), organizationId: 'org-a', orderId: 'ord-x' }) as never
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns 413 for oversized file', async () => {
    createOrganizationDocumentMock.mockResolvedValue({ ok: false, error: 'too_large' });
    const res = await uploadPost(buildReq({ file: pdf(), organizationId: 'org-a' }) as never);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: 'too_large' });
  });

  it('returns 415 for unsupported MIME type', async () => {
    createOrganizationDocumentMock.mockResolvedValue({ ok: false, error: 'invalid_mime' });
    const res = await uploadPost(
      buildReq({
        file: new File(['x'], 'virus.exe', { type: 'application/x-msdownload' }),
        organizationId: 'org-a',
      }) as never
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('returns 500 when storage upload fails', async () => {
    createOrganizationDocumentMock.mockResolvedValue({ ok: false, error: 'storage' });
    const res = await uploadPost(buildReq({ file: pdf(), organizationId: 'org-a' }) as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'storage' });
  });
});
