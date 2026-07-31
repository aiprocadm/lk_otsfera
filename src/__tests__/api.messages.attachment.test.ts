import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before any module import that might transitively
// load the real implementations.
// ---------------------------------------------------------------------------
const { requireSessionMock, uploadChatAttachmentMock, getChatAttachmentSignedUrlMock } = vi.hoisted(
  () => ({
    requireSessionMock: vi.fn(),
    uploadChatAttachmentMock: vi.fn(),
    getChatAttachmentSignedUrlMock: vi.fn(),
  })
);

vi.mock('@/lib/auth/guard', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/services/chat/attachments', () => ({
  uploadChatAttachment: uploadChatAttachmentMock,
  getChatAttachmentSignedUrl: getChatAttachmentSignedUrlMock,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// ---------------------------------------------------------------------------
// Route imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { POST, GET } from '@/app/api/messages/attachment/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function orgSession(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'u-org-1',
    role: 'organization',
    email: 'org@local',
    orgIds: ['org-1'],
    ...overrides,
  };
}

function managerSession(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'u-mgr-1',
    role: 'manager',
    email: 'mgr@local',
    managedOrgIds: ['org-1'],
    ...overrides,
  };
}

function buildFormData(opts: { file?: File | null; orderId?: string; side?: string }) {
  const fd = new FormData();
  if (opts.file !== null && opts.file !== undefined) {
    fd.set('file', opts.file);
  }
  if (opts.orderId !== undefined) fd.set('orderId', opts.orderId);
  if (opts.side !== undefined) fd.set('side', opts.side);
  return fd;
}

function postReq(formData: FormData) {
  return new Request('https://app.local/api/messages/attachment', {
    method: 'POST',
    body: formData,
  });
}

function getReq(messageId?: string) {
  const url = messageId
    ? `https://app.local/api/messages/attachment?messageId=${messageId}`
    : 'https://app.local/api/messages/attachment';
  return new Request(url);
}

// ---------------------------------------------------------------------------
// POST /api/messages/attachment
// ---------------------------------------------------------------------------
describe('POST /api/messages/attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEATURE_CHAT = '1';
    requireSessionMock.mockResolvedValue({ ok: true, value: orgSession() });
  });

  it('org session + valid PDF file → 201 with attachmentPath', async () => {
    uploadChatAttachmentMock.mockResolvedValue({
      ok: true,
      attachmentPath: 'chat/ord-1/uuid-file.pdf',
    });
    const fd = buildFormData({
      file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }),
      orderId: 'ord-1',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; attachmentPath: string };
    expect(json).toEqual({ ok: true, attachmentPath: 'chat/ord-1/uuid-file.pdf' });
    expect(uploadChatAttachmentMock).toHaveBeenCalledTimes(1);
  });

  it('flag OFF → 404, service not called', async () => {
    process.env.FEATURE_CHAT = '0';
    const fd = buildFormData({
      file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }),
      orderId: 'ord-1',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(404);
    expect(uploadChatAttachmentMock).not.toHaveBeenCalled();
  });

  it('no file field → 400', async () => {
    const fd = buildFormData({ orderId: 'ord-1' });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(uploadChatAttachmentMock).not.toHaveBeenCalled();
  });

  it('missing orderId → 400', async () => {
    const fd = buildFormData({
      file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }),
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(uploadChatAttachmentMock).not.toHaveBeenCalled();
  });

  it('service returns forbidden → 403', async () => {
    uploadChatAttachmentMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const fd = buildFormData({
      file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }),
      orderId: 'ord-1',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'forbidden' });
  });

  it('service returns too_large → 413', async () => {
    uploadChatAttachmentMock.mockResolvedValue({ ok: false, error: 'too_large' });
    const fd = buildFormData({
      file: new File(['x'], 'big.pdf', { type: 'application/pdf' }),
      orderId: 'ord-1',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(413);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'too_large' });
  });

  it('service returns invalid_mime → 415', async () => {
    uploadChatAttachmentMock.mockResolvedValue({ ok: false, error: 'invalid_mime' });
    const fd = buildFormData({
      file: new File(['x'], 'virus.exe', { type: 'application/x-msdownload' }),
      orderId: 'ord-1',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(415);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'invalid_mime' });
  });

  it('service returns order_not_found → 404', async () => {
    uploadChatAttachmentMock.mockResolvedValue({ ok: false, error: 'order_not_found' });
    const fd = buildFormData({
      file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }),
      orderId: 'ord-999',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(404);
  });

  it('service returns storage → 500', async () => {
    uploadChatAttachmentMock.mockResolvedValue({ ok: false, error: 'storage' });
    const fd = buildFormData({
      file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }),
      orderId: 'ord-1',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'storage' });
  });

  it('manager session with side="org" passed → service called with side "org"', async () => {
    requireSessionMock.mockResolvedValue({ ok: true, value: managerSession() });
    uploadChatAttachmentMock.mockResolvedValue({ ok: true, attachmentPath: 'chat/ord-1/x.pdf' });
    const fd = buildFormData({
      file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }),
      orderId: 'ord-1',
      side: 'org',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(201);
    const [, , args] = uploadChatAttachmentMock.mock.calls[0]!;
    expect(args.side).toBe('org');
  });

  it('manager session with no side → 400 (team must specify side)', async () => {
    requireSessionMock.mockResolvedValue({ ok: true, value: managerSession() });
    const fd = buildFormData({
      file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }),
      orderId: 'ord-1',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(uploadChatAttachmentMock).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401, service not called', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const fd = buildFormData({
      file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }),
      orderId: 'ord-1',
    });
    const res = await POST(postReq(fd));
    expect(res.status).toBe(401);
    expect(uploadChatAttachmentMock).not.toHaveBeenCalled();
  });

  it('formData parse throws (non-multipart body) → 400', async () => {
    // Send a plain JSON body so req.formData() throws a TypeError
    const badReq = new Request('https://app.local/api/messages/attachment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'bad' }),
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(uploadChatAttachmentMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/messages/attachment
// ---------------------------------------------------------------------------
describe('GET /api/messages/attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEATURE_CHAT = '1';
    requireSessionMock.mockResolvedValue({ ok: true, value: orgSession() });
  });

  it('valid messageId with attachmentPath → 302 redirect to signed URL', async () => {
    const signedUrl = 'https://storage.example.com/signed?token=abc';
    getChatAttachmentSignedUrlMock.mockResolvedValue({ ok: true, url: signedUrl });
    const res = await GET(getReq('msg-1'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(signedUrl);
    expect(getChatAttachmentSignedUrlMock).toHaveBeenCalledWith({}, orgSession(), 'msg-1');
  });

  it('flag OFF → 404, service not called', async () => {
    process.env.FEATURE_CHAT = '0';
    const res = await GET(getReq('msg-1'));
    expect(res.status).toBe(404);
    expect(getChatAttachmentSignedUrlMock).not.toHaveBeenCalled();
  });

  it('service returns not_found → 404', async () => {
    getChatAttachmentSignedUrlMock.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await GET(getReq('msg-1'));
    expect(res.status).toBe(404);
  });

  it('service returns forbidden → 403', async () => {
    getChatAttachmentSignedUrlMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await GET(getReq('msg-1'));
    expect(res.status).toBe(403);
  });

  it('missing messageId → 404 (not_found from service or direct check)', async () => {
    getChatAttachmentSignedUrlMock.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await GET(getReq());
    // No messageId → service called with empty string → not_found → 404
    expect(res.status).toBe(404);
  });

  it('unauthenticated → 401', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await GET(getReq('msg-1'));
    expect(res.status).toBe(401);
    expect(getChatAttachmentSignedUrlMock).not.toHaveBeenCalled();
  });

  it('service returns storage error → 502', async () => {
    getChatAttachmentSignedUrlMock.mockResolvedValue({ ok: false, error: 'storage' });
    const res = await GET(getReq('msg-1'));
    expect(res.status).toBe(502);
  });
});
