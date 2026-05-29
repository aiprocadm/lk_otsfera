import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  orderFindUnique,
  commentCount,
  documentCreate,
  auditCreate,
  storageUpload,
  queueAdd,
  notifyOrgUsersMock
} = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  commentCount: vi.fn().mockResolvedValue(0),
  documentCreate: vi.fn(),
  auditCreate: vi.fn(),
  storageUpload: vi.fn(),
  queueAdd: vi.fn(),
  notifyOrgUsersMock: vi.fn()
}));

vi.mock('@/lib/storage/supabase', () => ({
  documentBucket: 'documents',
  supabaseAdmin: {
    storage: { from: () => ({ upload: storageUpload }) }
  }
}));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: queueAdd }),
  QUEUE_NAMES: ['docs.scanDocument']
}));
vi.mock('@/lib/notifications', () => ({
  notifyOrgUsers: notifyOrgUsersMock
}));

import { createOrderDocument } from '@/lib/services/manager/uploads';
import type { SessionPayload } from '@/lib/auth/jwt';

function prismaMock() {
  return {
    order: { findUnique: orderFindUnique },
    comment: { count: commentCount },
    document: { create: documentCreate },
    auditLog: { create: auditCreate }
  };
}

function session(opts: { sub?: string; managedOrgIds?: string[] } = {}): SessionPayload {
  return {
    sub: opts.sub ?? 'u-mgr-1',
    role: 'manager',
    managedOrgIds: opts.managedOrgIds ?? []
  };
}

function pdfArgs(overrides: Partial<{ size: number; mimeType: string; name: string; docType: string; orderId: string }> = {}) {
  return {
    orderId: overrides.orderId ?? 'ord-1',
    docType: overrides.docType ?? 'contract',
    file: {
      name: overrides.name ?? 'invoice.pdf',
      size: overrides.size ?? 1024,
      mimeType: overrides.mimeType ?? 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 minimal pdf bytes')
    }
  };
}

describe('services/manager/uploads — createOrderDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commentCount.mockResolvedValue(0);
    storageUpload.mockResolvedValue({ data: { path: 'x' }, error: null });
    queueAdd.mockResolvedValue(undefined);
    notifyOrgUsersMock.mockResolvedValue({
      recipientsNotified: 0,
      emailsSent: 0,
      emailsSkipped: 0
    });
    documentCreate.mockResolvedValue({ id: 'doc-1' });
  });

  it('happy path: per-org scope → uploads, persists, enqueues scan, audits, notifies org', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: null,
      organizationId: 'org-a',
      orderNumber: 'O-100',
      title: 'Заказ #100'
    });
    const prisma = prismaMock();

    const r = await createOrderDocument(
      prisma as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs()
    );

    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
    expect(storageUpload).toHaveBeenCalledTimes(1);
    const [storagePath, buffer, opts] = storageUpload.mock.calls[0]!;
    expect(typeof storagePath).toBe('string');
    expect(storagePath).toMatch(/^orders\/ord-1\/.+-invoice\.pdf$/);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(opts).toMatchObject({ contentType: 'application/pdf', upsert: false });

    expect(documentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'ord-1',
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        type: 'contract',
        direction: 'outgoing',
        generatedBy: 'user',
        scanStatus: 'pending',
        uploadedById: 'u-mgr-1'
      })
    });

    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'document', id: 'doc-1' });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(notifyOrgUsersMock).toHaveBeenCalledTimes(1);
    expect(notifyOrgUsersMock).toHaveBeenCalledWith(prisma, {
      organizationId: 'org-a',
      type: 'document_published',
      payload: {
        orderId: 'ord-1',
        orderNumber: 'O-100',
        orderTitle: 'Заказ #100',
        documentName: 'invoice.pdf',
        documentType: 'contract'
      }
    });
  });

  it('returns too_large when file > 20 MB', async () => {
    const r = await createOrderDocument(
      prismaMock() as never,
      session(),
      pdfArgs({ size: 20 * 1024 * 1024 + 1 })
    );
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('returns invalid_mime for disallowed content type', async () => {
    const r = await createOrderDocument(
      prismaMock() as never,
      session(),
      pdfArgs({ mimeType: 'application/x-msdownload' })
    );
    expect(r).toEqual({ ok: false, error: 'invalid_mime' });
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('returns not_found when the order does not exist', async () => {
    orderFindUnique.mockResolvedValue(null);
    const r = await createOrderDocument(
      prismaMock() as never,
      session({ managedOrgIds: ['org-a'] }),
      pdfArgs()
    );
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('returns forbidden when the order is out of three-way scope', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'someone-else',
      organizationId: 'org-foreign',
      orderNumber: 'O-200',
      title: 'Foreign'
    });
    commentCount.mockResolvedValue(0);
    const r = await createOrderDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs()
    );
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(storageUpload).not.toHaveBeenCalled();
    expect(documentCreate).not.toHaveBeenCalled();
    expect(notifyOrgUsersMock).not.toHaveBeenCalled();
  });

  it('allows upload via comments-history path when order/org checks miss', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'someone-else',
      organizationId: 'org-foreign',
      orderNumber: 'O-300',
      title: 'Historical'
    });
    commentCount.mockResolvedValue(2);

    const r = await createOrderDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: [] }),
      pdfArgs()
    );
    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
    expect(commentCount).toHaveBeenCalled();
  });

  it('returns storage error when Supabase upload fails (no DB row created)', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: null,
      organizationId: 'org-a',
      orderNumber: 'O-400',
      title: 'StorageDown'
    });
    storageUpload.mockResolvedValue({
      data: null,
      error: { message: 'storage down' }
    });
    const r = await createOrderDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs()
    );
    expect(r).toEqual({ ok: false, error: 'storage' });
    expect(documentCreate).not.toHaveBeenCalled();
    expect(notifyOrgUsersMock).not.toHaveBeenCalled();
  });

  it('skips notifyOrgUsers when order has no organizationId', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: null,
      orderNumber: 'O-500',
      title: 'NoOrg'
    });
    const r = await createOrderDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: [] }),
      pdfArgs()
    );
    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
    expect(notifyOrgUsersMock).not.toHaveBeenCalled();
  });

  it('coerces unknown docType to "other"', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: 'org-a',
      orderNumber: 'O-600',
      title: 'CoerceType'
    });
    await createOrderDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs({ docType: 'bogus-value' })
    );
    expect(documentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'other' })
    });
  });

  it('swallows queue enqueue failure but still succeeds + notifies', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: 'org-a',
      orderNumber: 'O-700',
      title: 'QueueDown'
    });
    queueAdd.mockRejectedValueOnce(new Error('redis down'));
    const r = await createOrderDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs()
    );
    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
    expect(notifyOrgUsersMock).toHaveBeenCalled();
  });

  it('swallows notification failure but still returns ok', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: 'org-a',
      orderNumber: 'O-800',
      title: 'NotifyDown'
    });
    notifyOrgUsersMock.mockRejectedValueOnce(new Error('email API down'));
    const r = await createOrderDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs()
    );
    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
  });
});
