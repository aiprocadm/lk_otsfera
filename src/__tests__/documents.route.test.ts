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
  enqueueAdd,
  docFindMany
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
  enqueueAdd: vi.fn(),
  docFindMany: vi.fn()
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique },
    organization: { findFirst: orgFindFirst },
    document: { create, findUnique: vi.fn(), findMany: docFindMany },
    auditLog: { create: auditCreate }
  }
}));
vi.mock('@/lib/auth/policy', () => ({
  canReadOrder,
  canReadDocument,
  forbiddenResponse: (m: string) => Response.json({ message: m }, { status: 403 })
}));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload, createSignedUrl, remove: vi.fn(), download: vi.fn() })
}));
vi.mock('@/lib/notifications', () => ({ notifyDocumentCreated: vi.fn(), triggerNotificationEmail: vi.fn(), triggerNotificationTelegram: vi.fn() }));
vi.mock('@/lib/auth/organization', () => ({ getPrimaryOrganizationId: vi.fn().mockResolvedValue('o1') }));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: enqueueAdd }),
  QUEUE_NAMES: ['docs.scanDocument']
}));

import { GET as listGet } from '@/app/api/documents/route';
import { POST as uploadPost } from '@/app/api/documents/upload/route';
import { POST as downloadPost } from '@/app/api/documents/[id]/download/route';

describe('documents guards', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue({ role: 'admin', sub: 'u1', partnerId: 'p1' });
    findUnique.mockResolvedValue({ id: 'ord1', companyId: 'c1' });
    orgFindFirst.mockResolvedValue({ id: 'o1', partnerId: 'p1' });
    canReadOrder.mockResolvedValue(true);
    upload.mockResolvedValue(undefined);
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

  it('denies upload for non-admin roles (channel-scoped paths must be used instead)', async () => {
    getSession.mockResolvedValue({ role: 'partner', sub: 'u1', partnerId: 'p1' });
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('still returns success when notification fan-out fails (best-effort)', async () => {
    const { notifyDocumentCreated } = await import('@/lib/notifications');
    (notifyDocumentCreated as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('notify down'));
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(
      new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd })
    );
    expect(res.status).toBe(200);
  });

  it('still returns success when notification fan-out throws non-Error (String(err) branch)', async () => {
    const { notifyDocumentCreated } = await import('@/lib/notifications');
    (notifyDocumentCreated as ReturnType<typeof vi.fn>).mockRejectedValueOnce('plain string rejection');
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(
      new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd })
    );
    expect(res.status).toBe(200);
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

  it('still returns success when scan enqueue throws non-Error (String(err) branch)', async () => {
    enqueueAdd.mockRejectedValueOnce('plain string rejection');
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
    createSignedUrl.mockResolvedValue('https://signed');
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalled();
  });

  it('401 when no session for download', async () => {
    getSession.mockResolvedValue(null);
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(401);
  });

  it('404 when document not found for download', async () => {
    const { prisma } = await import('@/lib/db/prisma');
    (prisma.document.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(404);
  });

  it('502 when storage createSignedUrl returns error', async () => {
    const { prisma } = await import('@/lib/db/prisma');
    (prisma.document.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'd1', path: 'x', name: 'x.pdf', scanStatus: 'clean', scanReason: null,
      orderId: 'ord1', companyId: 'c1', counterpartyType: 'organization', counterpartyId: 'o1',
      order: { companyId: 'c1' }
    });
    canReadDocument.mockResolvedValue(true);
    createSignedUrl.mockRejectedValue(new Error('bucket error'));
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(502);
  });

  it('502 when createSignedUrl throws a non-Error (String(error) branch)', async () => {
    const { prisma } = await import('@/lib/db/prisma');
    (prisma.document.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'd1', path: 'x', name: 'x.pdf', scanStatus: 'clean', scanReason: null,
      orderId: 'ord1', companyId: 'c1', counterpartyType: 'organization', counterpartyId: 'o1',
      order: { companyId: 'c1' }
    });
    canReadDocument.mockResolvedValue(true);
    createSignedUrl.mockRejectedValue('provider exploded');
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(502);
  });

  it('200 with signed URL and TTL when document is clean', async () => {
    const { prisma } = await import('@/lib/db/prisma');
    (prisma.document.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'd1', path: 'p/d1.pdf', name: 'd1.pdf', scanStatus: 'clean', scanReason: null,
      orderId: 'ord1', companyId: 'c1', counterpartyType: 'organization', counterpartyId: 'o1',
      order: { companyId: 'c1' }
    });
    canReadDocument.mockResolvedValue(true);
    createSignedUrl.mockResolvedValue('https://cdn.example/signed');
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download?ttl=90', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.downloadUrl).toBe('https://cdn.example/signed');
    expect(body.expiresInSec).toBeGreaterThanOrEqual(60);
  });

  it('resolveTtl falls back to DEFAULT_TTL when ttl param is non-numeric (NaN branch)', async () => {
    const { prisma } = await import('@/lib/db/prisma');
    (prisma.document.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'd1', path: 'p/d1.pdf', name: 'd1.pdf', scanStatus: 'clean', scanReason: null,
      orderId: 'ord1', companyId: 'c1', counterpartyType: 'organization', counterpartyId: 'o1',
      order: { companyId: 'c1' }
    });
    canReadDocument.mockResolvedValue(true);
    createSignedUrl.mockResolvedValue('https://cdn.example/signed');
    // Pass a non-numeric TTL; Number('abc') = NaN → should fall back to DEFAULT_TTL (120)
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download?ttl=abc', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expiresInSec).toBe(120); // DEFAULT_TTL clamped to [60,300]
  });

  it('410 INFECTED with null scanReason (scanReason ?? undefined = undefined)', async () => {
    getSession.mockResolvedValue({ role: 'partner', sub: 'u1', partnerId: 'p1' });
    const { prisma } = await import('@/lib/db/prisma');
    (prisma.document.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'd1', path: 'x', name: 'x.pdf',
      scanStatus: 'infected',
      scanReason: null, // null → ?? undefined gives undefined
      order: { companyId: 'c1' }
    });
    canReadDocument.mockResolvedValue(true);
    const res = await downloadPost(
      new Request('https://app.local/api/documents/d1/download', { method: 'POST' }),
      { params: Promise.resolve({ id: 'd1' }) }
    );
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.scanReason).toBeUndefined();
  });
});

describe('documents/upload missing branches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue({ role: 'admin', sub: 'u1', partnerId: 'p1' });
    findUnique.mockResolvedValue({ id: 'ord1', companyId: 'c1', organizationId: 'o1' });
    orgFindFirst.mockResolvedValue({ id: 'o1', partnerId: 'p1' });
    canReadOrder.mockResolvedValue(true);
    upload.mockResolvedValue(undefined);
    create.mockResolvedValue({ id: 'd1', name: 'x.pdf', mimeType: 'application/pdf', createdAt: new Date() });
  });

  it('401 when no session for upload', async () => {
    getSession.mockResolvedValue(null);
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(401);
  });

  it('400 when form-data parse fails', async () => {
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: 'not-form', headers: { 'content-type': 'text/plain' } }));
    expect(res.status).toBe(400);
  });

  it('400 when orderId missing', async () => {
    const fd = new FormData();
    fd.set('file', new File(['%PDF-1.4 blah'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(400);
  });

  it('400 when magic bytes mismatch declared MIME (disguised exe as pdf)', async () => {
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    // Declare PDF but send PNG magic bytes
    fd.set('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])], 'trap.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(400);
  });

  it('404 when order not found', async () => {
    findUnique.mockResolvedValue(null);
    const fd = new FormData();
    fd.set('orderId', 'missing');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(404);
  });

  it('400 when organization context not found for order', async () => {
    orgFindFirst.mockResolvedValue(null);
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(400);
  });

  it('502 when storage upload fails', async () => {
    upload.mockRejectedValue(new Error('bucket full'));
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(502);
  });

  it('502 when storage upload throws a non-Error (String(uploadError) branch)', async () => {
    upload.mockRejectedValue('disk full');
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(502);
  });

  it('400 when file exceeds MAX_FILE_SIZE_BYTES', async () => {
    // Create a file larger than 10MB (default MAX_FILE_SIZE_MB = 10)
    const tenMbPlusOne = new Uint8Array(10 * 1024 * 1024 + 1);
    // Prefix with PDF magic bytes so it passes the magic-byte check if reached
    tenMbPlusOne[0] = 0x25; tenMbPlusOne[1] = 0x50; tenMbPlusOne[2] = 0x44; tenMbPlusOne[3] = 0x46;
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File([tenMbPlusOne], 'huge.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('FILE_TOO_LARGE');
  });
});

describe('GET /api/documents list — channel-isolation role restriction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    docFindMany.mockResolvedValue([]);
  });

  it('returns 403 for organization role (must use channel-scoped service layer)', async () => {
    getSession.mockResolvedValue({ role: 'organization', sub: 'u1', organizationId: 'org1' });
    const res = await listGet();
    expect(res.status).toBe(403);
    expect(docFindMany).not.toHaveBeenCalled();
  });

  it('returns 403 for partner role (must use channel-scoped service layer)', async () => {
    getSession.mockResolvedValue({ role: 'partner', sub: 'u1', partnerId: 'p1' });
    const res = await listGet();
    expect(res.status).toBe(403);
    expect(docFindMany).not.toHaveBeenCalled();
  });

  it('returns 200 for admin role and calls findMany', async () => {
    getSession.mockResolvedValue({ role: 'admin', sub: 'admin1' });
    docFindMany.mockResolvedValue([{ id: 'd1', name: 'f.pdf', mimeType: 'application/pdf', createdAt: new Date(), orderId: 'ord1' }]);
    const res = await listGet();
    expect(res.status).toBe(200);
    expect(docFindMany).toHaveBeenCalled();
  });

  it('returns 403 for manager role (reads go through managerDocumentScope)', async () => {
    // The old manager branch filtered via organizationUsers, which never
    // matches a manager account — it always returned an empty list. The
    // endpoint is admin-only (sole consumer: admin DocumentsPanel).
    getSession.mockResolvedValue({ role: 'manager', sub: 'mgr1' });
    const res = await listGet();
    expect(res.status).toBe(403);
    expect(docFindMany).not.toHaveBeenCalled();
  });
});
