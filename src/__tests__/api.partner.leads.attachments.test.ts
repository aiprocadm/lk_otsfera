import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/services/partner/leadAttachments', () => ({
  uploadLeadAttachment: vi.fn(),
  deleteLeadAttachment: vi.fn(),
  getLeadAttachmentDownloadUrl: vi.fn(),
  listLeadAttachments: vi.fn(),
  LeadAttachmentError: class LeadAttachmentError extends Error {
    constructor(
      public code: string,
      message: string,
      public meta?: { scanReason?: string | null }
    ) {
      super(message);
      this.name = 'LeadAttachmentError';
    }
  }
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import {
  uploadLeadAttachment,
  deleteLeadAttachment,
  getLeadAttachmentDownloadUrl,
  listLeadAttachments
} from '@/lib/services/partner/leadAttachments';
import { GET as listGET, POST as uploadPOST } from '@/app/api/partner/leads/[id]/attachments/route';
import { DELETE as deleteDELETE } from '@/app/api/partner/leads/[id]/attachments/[attachmentId]/route';
import { GET as downloadGET } from '@/app/api/partner/leads/[id]/attachments/[attachmentId]/download/route';

function partnerSession() {
  return {
    sub: 'u1',
    role: 'partner',
    partnerId: 'p1',
    partnerRole: 'manager',
    assignedOrgIds: []
  } as never;
}

// Session without assignedOrgIds (undefined branch of scopeOf)
function partnerSessionNoScope() {
  return {
    sub: 'u1',
    role: 'partner',
    partnerId: 'p1',
    partnerRole: 'manager'
    // no assignedOrgIds
  } as never;
}

// Session WITH assignedOrgIds (non-empty) → scopeOf returns the array
function partnerSessionScoped() {
  return {
    sub: 'u1',
    role: 'partner',
    partnerId: 'p1',
    partnerRole: 'manager',
    assignedOrgIds: ['org-1']
  } as never;
}

// Reset feature flag to enabled by default before each suite
function enableFlag() {
  vi.mocked(notFoundIfDisabled).mockReturnValue(null);
}

function fakeFormData(file: Blob, filename: string): FormData {
  const fd = new FormData();
  fd.append('file', file, filename);
  return fd;
}

function fakeReqFromForm(form: FormData): Request {
  return new Request('http://test.local/api/upload', { method: 'POST', body: form });
}

describe('GET /api/partner/leads/[id]/attachments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enableFlag();
  });

  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await listGET(new Request('http://t/'), { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(404);
  });

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await listGET(new Request('http://t/'), { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(401);
  });

  it('403 for non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'organization' } as never);
    const res = await listGET(new Request('http://t/'), { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(403);
  });

  it('404 when service returns NOT_FOUND', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(listLeadAttachments).mockResolvedValue({ ok: false, error: 'NOT_FOUND', message: 'not found' });
    const res = await listGET(new Request('http://t/'), { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(404);
  });

  it('403 when service returns FORBIDDEN', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(listLeadAttachments).mockResolvedValue({ ok: false, error: 'FORBIDDEN', message: 'forbidden' });
    const res = await listGET(new Request('http://t/'), { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(403);
  });

  it('200 with rows on success', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(listLeadAttachments).mockResolvedValue({ ok: true, rows: [{ id: 'att-1' }] } as never);
    const res = await listGET(new Request('http://t/'), { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
  });

  it('200 when session has no assignedOrgIds (scopeOf returns undefined)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSessionNoScope());
    vi.mocked(listLeadAttachments).mockResolvedValue({ ok: true, rows: [] } as never);
    const res = await listGET(new Request('http://t/'), { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(200);
    // scopeOrgIds=undefined is passed when assignedOrgIds is absent
    expect(vi.mocked(listLeadAttachments)).toHaveBeenCalledWith({}, expect.objectContaining({ scopeOrgIds: undefined }));
  });

  it('200 when session has non-empty assignedOrgIds (scopeOf returns array)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSessionScoped());
    vi.mocked(listLeadAttachments).mockResolvedValue({ ok: true, rows: [] } as never);
    const res = await listGET(new Request('http://t/'), { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(200);
    expect(vi.mocked(listLeadAttachments)).toHaveBeenCalledWith({}, expect.objectContaining({ scopeOrgIds: ['org-1'] }));
  });

  it('500 on unexpected throw', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(listLeadAttachments).mockRejectedValue(new Error('DB exploded'));
    const res = await listGET(new Request('http://t/'), { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/partner/leads/[id]/attachments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enableFlag();
  });

  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(404);
  });

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(401);
  });

  it('403 for non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'organization' } as never);
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(403);
  });

  it('415 when service rejects MIME', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockResolvedValue({
      ok: false,
      error: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'bad MIME'
    });
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.txt'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(415);
  });

  it('413 when service rejects size', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockResolvedValue({
      ok: false,
      error: 'FILE_TOO_LARGE',
      message: 'too big'
    });
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(413);
  });

  it('403 when lead not editable', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockResolvedValue({
      ok: false,
      error: 'LEAD_NOT_EDITABLE',
      message: 'not editable'
    });
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(403);
  });

  it('400 when form-data parse fails (non-multipart)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    // A plain JSON request will fail req.formData()
    const req = new Request('http://t/', { method: 'POST', body: 'not-form-data', headers: { 'content-type': 'text/plain' } });
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(400);
  });

  it('400 when file field missing in form', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    const fd = new FormData();
    fd.append('other', 'value');
    const req = new Request('http://t/', { method: 'POST', body: fd });
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(400);
  });

  it('400 when service returns INVALID_FILENAME', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockResolvedValue({ ok: false, error: 'INVALID_FILENAME', message: 'bad name' });
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'bad\x00name.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(400);
  });

  it('404 when service returns NOT_FOUND', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockResolvedValue({ ok: false, error: 'NOT_FOUND', message: 'lead not found' });
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(404);
  });

  it('410 when service returns INFECTED (with scanReason)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockResolvedValue({ ok: false, error: 'INFECTED', message: 'quarantined', meta: { scanReason: 'EICAR' } });
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('INFECTED');
    expect(body.scanReason).toBe('EICAR');
  });

  it('410 when service returns INFECTED (no meta/scanReason → scanReason=undefined)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockResolvedValue({ ok: false, error: 'INFECTED', message: 'quarantined' });
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('INFECTED');
    expect(body.scanReason).toBeUndefined();
  });

  it('201 when session has no assignedOrgIds (scopeOf undefined path)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSessionNoScope());
    const now = new Date();
    vi.mocked(uploadLeadAttachment).mockResolvedValue({ ok: true, attachment: { id: 'att-2', name: 'f.pdf', size: 100, mimeType: 'application/pdf', createdAt: now, path: '', leadId: 'l', createdByUserId: 'u' } } as never);
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'f.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(201);
    expect(vi.mocked(uploadLeadAttachment)).toHaveBeenCalledWith({}, expect.objectContaining({ scopeOrgIds: undefined }));
  });

  it('500 when service returns STORAGE_FAILURE', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockResolvedValue({ ok: false, error: 'STORAGE_FAILURE', message: 'storage down' });
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(500);
  });

  it('500 on unexpected throw', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockRejectedValue(new Error('unexpected'));
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(500);
  });

  it('201 on happy path with attachment metadata (blank file.type → application/octet-stream)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    const now = new Date('2026-05-22T10:00:00Z');
    vi.mocked(uploadLeadAttachment).mockResolvedValue({
      ok: true,
      attachment: {
        id: 'att-1',
        name: 'doc.pdf',
        size: 1024,
        mimeType: 'application/pdf',
        createdAt: now,
        path: 'partners/p1/leads/lead-1/abc.pdf',
        leadId: 'lead-1',
        createdByUserId: 'u1'
      }
    } as never);
    // Blob with no type → file.type = '' → fallback to 'application/octet-stream'
    const req = fakeReqFromForm(fakeFormData(new Blob(['hello']), 'doc.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('att-1');
    expect(body.name).toBe('doc.pdf');
    expect(vi.mocked(uploadLeadAttachment)).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ file: expect.objectContaining({ declaredMimeType: 'application/octet-stream' }) })
    );
  });

  it('201 on happy path when file.type is non-empty (covers L103 truthy branch)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    const now = new Date('2026-05-22T10:00:00Z');
    vi.mocked(uploadLeadAttachment).mockResolvedValue({
      ok: true,
      attachment: {
        id: 'att-2',
        name: 'doc.pdf',
        size: 512,
        mimeType: 'application/pdf',
        createdAt: now,
        path: 'partners/p1/leads/lead-1/xyz.pdf',
        leadId: 'lead-1',
        createdByUserId: 'u1'
      }
    } as never);
    // Blob WITH explicit type → file.type = 'application/pdf' → truthy → L103 branch[0]
    const fd = new FormData();
    fd.append('file', new File(['hello'], 'doc.pdf', { type: 'application/pdf' }));
    const req = new Request('http://test.local/api/upload', { method: 'POST', body: fd });
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(201);
    expect(vi.mocked(uploadLeadAttachment)).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ file: expect.objectContaining({ declaredMimeType: 'application/pdf' }) })
    );
  });
});

describe('DELETE /api/partner/leads/[id]/attachments/[attachmentId]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enableFlag();
  });

  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(404);
  });

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(401);
  });

  it('403 for non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'organization' } as never);
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(403);
  });

  it('404 when service returns NOT_FOUND', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(deleteLeadAttachment).mockResolvedValue({ ok: false, error: 'NOT_FOUND', message: 'not found' });
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(404);
  });

  it('500 on unexpected throw', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(deleteLeadAttachment).mockRejectedValue(new Error('boom'));
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(500);
  });

  it('403 when lead not editable', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(deleteLeadAttachment).mockResolvedValue({
      ok: false,
      error: 'LEAD_NOT_EDITABLE',
      message: 'not editable'
    });
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(403);
  });

  it('403 when forbidden (not own, not admin)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(deleteLeadAttachment).mockResolvedValue({
      ok: false,
      error: 'FORBIDDEN',
      message: 'not allowed'
    });
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(403);
  });

  it('204 on happy path', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(deleteLeadAttachment).mockResolvedValue({ ok: true });
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(204);
  });

  it('500 when service returns an unhandled error code (default case)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(deleteLeadAttachment).mockResolvedValue({ ok: false, error: 'STORAGE_FAILURE' as never, message: 'storage error' });
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(500);
  });

  it('204 when session has no assignedOrgIds (scopeOf undefined path)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSessionNoScope());
    vi.mocked(deleteLeadAttachment).mockResolvedValue({ ok: true });
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(204);
    expect(vi.mocked(deleteLeadAttachment)).toHaveBeenCalledWith({}, expect.objectContaining({ scopeOrgIds: undefined }));
  });

  it('204 when session has non-empty assignedOrgIds (scopeOf returns array)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSessionScoped());
    vi.mocked(deleteLeadAttachment).mockResolvedValue({ ok: true });
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(204);
    expect(vi.mocked(deleteLeadAttachment)).toHaveBeenCalledWith({}, expect.objectContaining({ scopeOrgIds: ['org-1'] }));
  });
});

describe('GET /api/partner/leads/[id]/attachments/[attachmentId]/download', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enableFlag();
  });

  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(404);
  });

  it('401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(401);
  });

  it('403 for non-partner', async () => {
    vi.mocked(getSession).mockResolvedValue({ sub: 'u', role: 'organization' } as never);
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(403);
  });

  it('500 fallback on generic service error', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(getLeadAttachmentDownloadUrl).mockResolvedValue({ ok: false, error: 'STORAGE_FAILURE' as never, message: 'storage down' });
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(500);
  });

  it('500 on unexpected throw', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(getLeadAttachmentDownloadUrl).mockRejectedValue(new Error('unexpected'));
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(500);
  });

  it('307 redirect on success', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(getLeadAttachmentDownloadUrl).mockResolvedValue({
      ok: true,
      url: 'https://signed.example/file.pdf',
      name: 'file.pdf',
      mimeType: 'application/pdf'
    });
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('https://signed.example/');
  });

  it('404 when attachment not found', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(getLeadAttachmentDownloadUrl).mockResolvedValue({
      ok: false,
      error: 'NOT_FOUND',
      message: 'not found'
    });
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(404);
  });

  it('410 Gone when attachment was flagged INFECTED, propagating virus name', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(getLeadAttachmentDownloadUrl).mockResolvedValue({
      ok: false,
      error: 'INFECTED',
      message: 'quarantined',
      meta: { scanReason: 'Win.Test.EICAR_HDB-1' }
    });
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('INFECTED');
    expect(body.scanReason).toBe('Win.Test.EICAR_HDB-1');
  });

  it('410 INFECTED with null meta (scanReason=undefined)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(getLeadAttachmentDownloadUrl).mockResolvedValue({
      ok: false,
      error: 'INFECTED',
      message: 'quarantined'
      // no meta
    });
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('INFECTED');
    expect(body.scanReason).toBeUndefined();
  });

  it('307 when session has no assignedOrgIds (scopeOf undefined path)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSessionNoScope());
    vi.mocked(getLeadAttachmentDownloadUrl).mockResolvedValue({ ok: true, url: 'https://cdn/file', name: 'f', mimeType: 'application/pdf' });
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(307);
    expect(vi.mocked(getLeadAttachmentDownloadUrl)).toHaveBeenCalledWith({}, expect.objectContaining({ scopeOrgIds: undefined }));
  });

  it('307 when session has non-empty assignedOrgIds (scopeOf returns array)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSessionScoped());
    vi.mocked(getLeadAttachmentDownloadUrl).mockResolvedValue({ ok: true, url: 'https://cdn/scoped', name: 'f', mimeType: 'application/pdf' });
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(307);
    expect(vi.mocked(getLeadAttachmentDownloadUrl)).toHaveBeenCalledWith({}, expect.objectContaining({ scopeOrgIds: ['org-1'] }));
  });
});
