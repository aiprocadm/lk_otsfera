import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  orderFindUnique,
  commentCount,
  documentCreate,
  auditCreate,
  storageUpload,
  queueAdd,
  notifyOrgUsersMock,
  notifyPartnerUsersMock,
  listManagerCounterpartiesMock
} = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  commentCount: vi.fn().mockResolvedValue(0),
  documentCreate: vi.fn(),
  auditCreate: vi.fn(),
  storageUpload: vi.fn(),
  queueAdd: vi.fn(),
  notifyOrgUsersMock: vi.fn(),
  notifyPartnerUsersMock: vi.fn(),
  listManagerCounterpartiesMock: vi.fn()
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload: storageUpload, createSignedUrl: vi.fn(), remove: vi.fn(), download: vi.fn() }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {}
}));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: queueAdd }),
  QUEUE_NAMES: ['docs.scanDocument']
}));
vi.mock('@/lib/notifications', () => ({
  notifyOrgUsers: notifyOrgUsersMock,
  notifyPartnerUsers: notifyPartnerUsersMock
}));
vi.mock('@/lib/services/manager/counterparties', () => ({
  listManagerCounterparties: listManagerCounterpartiesMock
}));

import { createCounterpartyDocument, createManagerOrderLessDocument } from '@/lib/services/manager/uploads';
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

function pdf() {
  return {
    name: 'invoice.pdf',
    size: 1024,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 minimal pdf bytes')
  };
}

function pdfArgs(overrides: Partial<{ size: number; mimeType: string; name: string; docType: string; orderId: string; recipient: 'organization' | 'partner' }> = {}) {
  return {
    orderId: overrides.orderId ?? 'ord-1',
    docType: overrides.docType ?? 'contract',
    recipient: overrides.recipient ?? 'organization',
    file: {
      name: overrides.name ?? 'invoice.pdf',
      size: overrides.size ?? 1024,
      mimeType: overrides.mimeType ?? 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 minimal pdf bytes')
    }
  };
}

describe('services/manager/uploads — createCounterpartyDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commentCount.mockResolvedValue(0);
    storageUpload.mockResolvedValue(undefined);
    queueAdd.mockResolvedValue(undefined);
    notifyOrgUsersMock.mockResolvedValue({
      recipientsNotified: 0,
      emailsSent: 0,
      emailsSkipped: 0
    });
    notifyPartnerUsersMock.mockResolvedValue({
      recipientsNotified: 0,
      emailsSent: 0,
      emailsSkipped: 0
    });
    documentCreate.mockResolvedValue({ id: 'doc-1' });
    listManagerCounterpartiesMock.mockResolvedValue({
      organizations: [{ id: 'o1', name: 'O' }],
      partners: []
    });
  });

  it('happy path: per-org scope → uploads, persists, enqueues scan, audits, notifies org', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: null,
      organizationId: 'org-a',
      partnerId: null,
      orderNumber: 'O-100',
      title: 'Заказ #100'
    });
    const prisma = prismaMock();

    const r = await createCounterpartyDocument(
      prisma as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs({ recipient: 'organization' })
    );

    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
    expect(storageUpload).toHaveBeenCalledTimes(1);
    const [storagePath, buffer, opts] = storageUpload.mock.calls[0]!;
    expect(typeof storagePath).toBe('string');
    expect(storagePath).toMatch(/^orders\/ord-1\/.+-invoice\.pdf$/);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(opts).toMatchObject({ contentType: 'application/pdf' });

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
    expect(notifyPartnerUsersMock).not.toHaveBeenCalled();
  });

  it('returns too_large when file > 200 MB (config-driven limit §11)', async () => {
    const r = await createCounterpartyDocument(
      prismaMock() as never,
      session(),
      pdfArgs({ size: 201 * 1024 * 1024, recipient: 'organization' })
    );
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('returns invalid_mime for disallowed content type', async () => {
    const r = await createCounterpartyDocument(
      prismaMock() as never,
      session(),
      pdfArgs({ mimeType: 'application/x-msdownload', recipient: 'organization' })
    );
    expect(r).toEqual({ ok: false, error: 'invalid_mime' });
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('returns not_found when the order does not exist', async () => {
    orderFindUnique.mockResolvedValue(null);
    const r = await createCounterpartyDocument(
      prismaMock() as never,
      session({ managedOrgIds: ['org-a'] }),
      pdfArgs({ recipient: 'organization' })
    );
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('returns forbidden when the order is out of three-way scope', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'someone-else',
      organizationId: 'org-foreign',
      partnerId: null,
      orderNumber: 'O-200',
      title: 'Foreign'
    });
    commentCount.mockResolvedValue(0);
    const r = await createCounterpartyDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs({ recipient: 'organization' })
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
      partnerId: null,
      orderNumber: 'O-300',
      title: 'Historical'
    });
    commentCount.mockResolvedValue(2);

    const r = await createCounterpartyDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: [] }),
      pdfArgs({ recipient: 'organization' })
    );
    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
    expect(commentCount).toHaveBeenCalled();
  });

  it('returns storage error when object storage (S3) upload fails (no DB row created)', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: null,
      organizationId: 'org-a',
      partnerId: null,
      orderNumber: 'O-400',
      title: 'StorageDown'
    });
    storageUpload.mockRejectedValue(new Error('storage down'));
    const r = await createCounterpartyDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs({ recipient: 'organization' })
    );
    expect(r).toEqual({ ok: false, error: 'storage' });
    expect(documentCreate).not.toHaveBeenCalled();
    expect(notifyOrgUsersMock).not.toHaveBeenCalled();
  });

  it('coerces unknown docType to "other"', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: 'org-a',
      partnerId: null,
      orderNumber: 'O-600',
      title: 'CoerceType'
    });
    await createCounterpartyDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs({ docType: 'bogus-value', recipient: 'organization' })
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
      partnerId: null,
      orderNumber: 'O-700',
      title: 'QueueDown'
    });
    queueAdd.mockRejectedValueOnce(new Error('redis down'));
    const r = await createCounterpartyDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs({ recipient: 'organization' })
    );
    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
    expect(notifyOrgUsersMock).toHaveBeenCalled();
  });

  it('swallows notification failure but still returns ok', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord-1',
      managerId: 'u-mgr-1',
      organizationId: 'org-a',
      partnerId: null,
      orderNumber: 'O-800',
      title: 'NotifyDown'
    });
    notifyOrgUsersMock.mockRejectedValueOnce(new Error('email API down'));
    const r = await createCounterpartyDocument(
      prismaMock() as never,
      session({ sub: 'u-mgr-1', managedOrgIds: ['org-a'] }),
      pdfArgs({ recipient: 'organization' })
    );
    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
  });

  // ── New cases: recipient channel branching ──────────────────────────────────

  it('recipient=organization sets counterpartyType organization + direction outgoing + notifyOrgUsers only', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      managerId: 'u-mgr-1',
      organizationId: 'org1',
      partnerId: 'p1',
      companyId: 'c1',
      orderNumber: '1',
      title: 'T'
    });
    const prisma = prismaMock();

    const r = await createCounterpartyDocument(prisma as never, session({ sub: 'u-mgr-1', managedOrgIds: ['org1'] }), {
      orderId: 'o1',
      recipient: 'organization',
      docType: 'contract',
      file: pdf()
    });

    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
    expect(documentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        counterpartyType: 'organization',
        counterpartyId: 'org1',
        direction: 'outgoing'
      })
    });
    expect(notifyOrgUsersMock).toHaveBeenCalledTimes(1);
    expect(notifyPartnerUsersMock).not.toHaveBeenCalled();
  });

  it('recipient=partner on an order with a partner sets counterpartyType partner + notifyPartnerUsers only', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      managerId: 'u-mgr-1',
      organizationId: 'org1',
      partnerId: 'p1',
      companyId: 'c1',
      orderNumber: '1',
      title: 'T'
    });
    const prisma = prismaMock();

    const r = await createCounterpartyDocument(prisma as never, session({ sub: 'u-mgr-1', managedOrgIds: ['org1'] }), {
      orderId: 'o1',
      recipient: 'partner',
      docType: 'commission_statement',
      file: pdf()
    });

    expect(r).toEqual({ ok: true, documentId: 'doc-1' });
    expect(documentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        counterpartyType: 'partner',
        counterpartyId: 'p1',
        direction: 'outgoing'
      })
    });
    expect(notifyPartnerUsersMock).toHaveBeenCalledTimes(1);
    expect(notifyOrgUsersMock).not.toHaveBeenCalled();
  });

  it('recipient=partner on a partnerless order is rejected before upload', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      managerId: 'm1',
      organizationId: 'org1',
      partnerId: null,
      companyId: 'c1',
      orderNumber: '1',
      title: 'T'
    });
    const r = await createCounterpartyDocument(prismaMock() as never, session({ sub: 'm1', managedOrgIds: ['org1'] }), {
      orderId: 'o1',
      recipient: 'partner',
      docType: 'commission_statement',
      file: pdf()
    });
    expect(r).toEqual({ ok: false, error: 'invalid_recipient' });
    expect(storageUpload).not.toHaveBeenCalled();
  });
});

describe('services/manager/uploads — createManagerOrderLessDocument', () => {
  function orderLessPrismaMock() {
    return {
      organization: { findMany: vi.fn() },
      partner: { findMany: vi.fn() },
      company: { findUnique: vi.fn().mockResolvedValue({ managerTeamVisibility: false }) },
      document: { create: documentCreate },
      auditLog: { create: auditCreate }
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    storageUpload.mockResolvedValue(undefined);
    queueAdd.mockResolvedValue(undefined);
    notifyOrgUsersMock.mockResolvedValue({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });
    notifyPartnerUsersMock.mockResolvedValue({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });
    documentCreate.mockResolvedValue({ id: 'd1' });
    listManagerCounterpartiesMock.mockResolvedValue({
      organizations: [{ id: 'o1', name: 'O' }],
      partners: []
    });
  });

  it('order-less: persists with companyId=session.companyId, orderId=null, direction outgoing', async () => {
    const sess = { sub: 'm1', role: 'manager', companyId: 'co-1', managedOrgIds: ['o1'] } as never;
    const prisma = orderLessPrismaMock();

    const res = await createManagerOrderLessDocument(prisma as never, sess, {
      counterparty: { type: 'organization', id: 'o1' },
      docType: 'other',
      file: { name: 'g.pdf', size: 9, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
    });

    expect(res).toEqual({ ok: true, documentId: 'd1' });
    expect(documentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: null,
        companyId: 'co-1',
        direction: 'outgoing',
        counterpartyType: 'organization',
        counterpartyId: 'o1'
      })
    });
    expect(notifyOrgUsersMock).toHaveBeenCalledTimes(1);
    expect(notifyPartnerUsersMock).not.toHaveBeenCalled();
  });

  it('order-less: rejects counterparty outside manager scope', async () => {
    const sess = { sub: 'm1', role: 'manager', companyId: 'co-1', managedOrgIds: ['o1'] } as never;
    const prisma = orderLessPrismaMock();

    const res = await createManagerOrderLessDocument(prisma as never, sess, {
      counterparty: { type: 'organization', id: 'oX' },
      docType: 'other',
      file: { name: 'g.pdf', size: 9, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
    });

    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(storageUpload).not.toHaveBeenCalled();
    expect(documentCreate).not.toHaveBeenCalled();
  });

  it('order-less: returns forbidden when session has no companyId', async () => {
    const sess = { sub: 'm1', role: 'manager', companyId: null, managedOrgIds: ['o1'] } as never;
    const prisma = orderLessPrismaMock();

    const res = await createManagerOrderLessDocument(prisma as never, sess, {
      counterparty: { type: 'organization', id: 'o1' },
      docType: 'other',
      file: { name: 'g.pdf', size: 9, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
    });

    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('order-less: swallows notify failure and still returns ok', async () => {
    notifyOrgUsersMock.mockRejectedValueOnce(new Error('email down'));
    const sess = { sub: 'm1', role: 'manager', companyId: 'co-1', managedOrgIds: ['o1'] } as never;
    const prisma = orderLessPrismaMock();

    const res = await createManagerOrderLessDocument(prisma as never, sess, {
      counterparty: { type: 'organization', id: 'o1' },
      docType: 'other',
      file: { name: 'g.pdf', size: 9, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
    });

    expect(res).toEqual({ ok: true, documentId: 'd1' });
  });

  it('order-less: routes to partner channel when counterparty.type=partner', async () => {
    listManagerCounterpartiesMock.mockResolvedValue({
      organizations: [],
      partners: [{ id: 'p1', name: 'P' }]
    });
    const sess = { sub: 'm1', role: 'manager', companyId: 'co-1', managedOrgIds: [] } as never;
    const prisma = orderLessPrismaMock();

    const res = await createManagerOrderLessDocument(prisma as never, sess, {
      counterparty: { type: 'partner', id: 'p1' },
      docType: 'contract',
      file: { name: 'c.pdf', size: 9, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }
    });

    expect(res).toEqual({ ok: true, documentId: 'd1' });
    expect(documentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: null,
        companyId: 'co-1',
        direction: 'outgoing',
        counterpartyType: 'partner',
        counterpartyId: 'p1'
      })
    });
    expect(notifyPartnerUsersMock).toHaveBeenCalledTimes(1);
    expect(notifyOrgUsersMock).not.toHaveBeenCalled();
  });
});
