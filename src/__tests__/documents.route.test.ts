import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSession,
  findUnique,
  orgFindFirst,
  create,
  auditCreate,
  canReadOrder,
  canReadDocument,
  upload,
  createSignedUrl,
  enqueueAdd
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUnique: vi.fn(),
  orgFindFirst: vi.fn(),
  create: vi.fn(),
  auditCreate: vi.fn(),
  canReadOrder: vi.fn(),
  canReadDocument: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  enqueueAdd: vi.fn()
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique },
    organization: { findFirst: orgFindFirst },
    document: { create, findUnique: vi.fn() },
    auditLog: { create: auditCreate }
  }
}));
vi.mock('@/lib/auth/policy', () => ({
  canReadOrder,
  canReadDocument,
  forbiddenResponse: (m: string) => Response.json({ message: m }, { status: 403 })
}));
vi.mock('@/lib/storage/supabase', () => ({
  documentBucket: 'docs',
  supabaseAdmin: { storage: { from: () => ({ upload, createSignedUrl }) } }
}));
vi.mock('@/lib/notifications', () => ({ notifyDocumentCreated: vi.fn(), triggerNotificationEmail: vi.fn() }));
vi.mock('@/lib/auth/organization', () => ({ getPrimaryOrganizationId: vi.fn().mockResolvedValue('o1') }));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: enqueueAdd }),
  QUEUE_NAMES: ['docs.scanDocument']
}));

import { POST as uploadPost } from '@/app/api/documents/upload/route';
import { POST as downloadPost } from '@/app/api/documents/[id]/download/route';

describe('documents guards', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue({ role: 'admin', sub: 'u1', partnerId: 'p1' });
    findUnique.mockResolvedValue({ id: 'ord1', companyId: 'c1' });
    orgFindFirst.mockResolvedValue({ id: 'o1', partnerId: 'p1' });
    canReadOrder.mockResolvedValue(true);
    upload.mockResolvedValue({ error: null });
    create.mockResolvedValue({ id: 'd1', name: 'x.pdf', mimeType: 'application/pdf', createdAt: new Date() });
  });

  it('validates MIME and size', async () => {
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['abc'], 'virus.exe', { type: 'application/octet-stream' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(400);
  });

  it('denies upload for foreign order', async () => {
    canReadOrder.mockResolvedValue(false);
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['ok'], 'doc.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(403);
  });

  it('denies read for foreign document', async () => {
    const { prisma } = await import('@/lib/db/prisma');
    (prisma.document.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'd1',
      path: 'x',
      name: 'x.pdf',
      order: { companyId: 'c1' }
    });
    canReadDocument.mockResolvedValue(false);
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(403);
  });

  it('enqueues docs.scanDocument after a successful upload', async () => {
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(
      new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd })
    );
    expect(res.status).toBe(200);
    expect(enqueueAdd).toHaveBeenCalledWith(
      'scan',
      expect.objectContaining({ kind: 'document', id: 'd1' })
    );
  });

  it('still returns success when scan enqueue fails (graceful)', async () => {
    enqueueAdd.mockRejectedValueOnce(new Error('Redis down'));
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(
      new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd })
    );
    expect(res.status).toBe(200);
  });

  it('returns 410 Gone when a non-admin tries to download an infected document', async () => {
    getSession.mockResolvedValue({ role: 'partner', sub: 'u1', partnerId: 'p1' });
    const { prisma } = await import('@/lib/db/prisma');
    (prisma.document.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'd1',
      path: 'x',
      name: 'x.pdf',
      scanStatus: 'infected',
      scanReason: 'Win.Test.EICAR_HDB-1',
      order: { companyId: 'c1' }
    });
    canReadDocument.mockResolvedValue(true);
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.code).toBe('INFECTED');
    expect(body.scanReason).toBe('Win.Test.EICAR_HDB-1');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('lets platform admin download an infected document (for forensics)', async () => {
    getSession.mockResolvedValue({ role: 'admin', sub: 'admin1', partnerId: null });
    const { prisma } = await import('@/lib/db/prisma');
    (prisma.document.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'd1',
      path: 'p/d1.pdf',
      name: 'x.pdf',
      scanStatus: 'infected',
      scanReason: 'Win.Test.EICAR_HDB-1',
      order: { companyId: 'c1' }
    });
    canReadDocument.mockResolvedValue(true);
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null });
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalled();
  });
});
