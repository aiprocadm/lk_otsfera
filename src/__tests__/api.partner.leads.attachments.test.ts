import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/services/partner/leadAttachments', () => ({
  uploadLeadAttachment: vi.fn(),
  deleteLeadAttachment: vi.fn(),
  getLeadAttachmentDownloadUrl: vi.fn(),
  listLeadAttachments: vi.fn(),
  LeadAttachmentError: class LeadAttachmentError extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = 'LeadAttachmentError';
    }
  }
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { getSession } from '@/lib/auth/session';
import {
  uploadLeadAttachment,
  deleteLeadAttachment,
  getLeadAttachmentDownloadUrl,
  LeadAttachmentError
} from '@/lib/services/partner/leadAttachments';
import { POST as uploadPOST } from '@/app/api/partner/leads/[id]/attachments/route';
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

function fakeFormData(file: Blob, filename: string): FormData {
  const fd = new FormData();
  fd.append('file', file, filename);
  return fd;
}

function fakeReqFromForm(form: FormData): Request {
  return new Request('http://test.local/api/upload', { method: 'POST', body: form });
}

describe('POST /api/partner/leads/[id]/attachments', () => {
  beforeEach(() => vi.resetAllMocks());

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
    vi.mocked(uploadLeadAttachment).mockRejectedValue(
      new LeadAttachmentError('UNSUPPORTED_MEDIA_TYPE', 'bad MIME')
    );
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.txt'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(415);
  });

  it('413 when service rejects size', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockRejectedValue(
      new LeadAttachmentError('FILE_TOO_LARGE', 'too big')
    );
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(413);
  });

  it('403 when lead not editable', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(uploadLeadAttachment).mockRejectedValue(
      new LeadAttachmentError('LEAD_NOT_EDITABLE', 'not editable')
    );
    const req = fakeReqFromForm(fakeFormData(new Blob(['x']), 'x.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(403);
  });

  it('201 on happy path with attachment metadata', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    const now = new Date('2026-05-22T10:00:00Z');
    vi.mocked(uploadLeadAttachment).mockResolvedValue({
      id: 'att-1',
      name: 'doc.pdf',
      size: 1024,
      mimeType: 'application/pdf',
      createdAt: now,
      path: 'partners/p1/leads/lead-1/abc.pdf',
      leadId: 'lead-1',
      createdByUserId: 'u1'
    } as never);
    const req = fakeReqFromForm(fakeFormData(new Blob(['hello']), 'doc.pdf'));
    const res = await uploadPOST(req, { params: Promise.resolve({ id: 'lead-1' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('att-1');
    expect(body.name).toBe('doc.pdf');
  });
});

describe('DELETE /api/partner/leads/[id]/attachments/[attachmentId]', () => {
  beforeEach(() => vi.resetAllMocks());

  it('403 when lead not editable', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(deleteLeadAttachment).mockRejectedValue(
      new LeadAttachmentError('LEAD_NOT_EDITABLE', 'not editable')
    );
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(403);
  });

  it('403 when forbidden (not own, not admin)', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(deleteLeadAttachment).mockRejectedValue(
      new LeadAttachmentError('FORBIDDEN', 'not allowed')
    );
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(403);
  });

  it('204 on happy path', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(deleteLeadAttachment).mockResolvedValue(undefined as never);
    const res = await deleteDELETE(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(204);
  });
});

describe('GET /api/partner/leads/[id]/attachments/[attachmentId]/download', () => {
  beforeEach(() => vi.resetAllMocks());

  it('307 redirect on success', async () => {
    vi.mocked(getSession).mockResolvedValue(partnerSession());
    vi.mocked(getLeadAttachmentDownloadUrl).mockResolvedValue({
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
    vi.mocked(getLeadAttachmentDownloadUrl).mockRejectedValue(
      new LeadAttachmentError('NOT_FOUND', 'not found')
    );
    const res = await downloadGET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'lead-1', attachmentId: 'att-1' })
    });
    expect(res.status).toBe(404);
  });
});
