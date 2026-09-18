import { describe, it, expect, vi, beforeEach } from 'vitest';

const { uploadMock, addMock, auditMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  addMock: vi.fn(),
  auditMock: vi.fn(),
}));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: uploadMock,
    createSignedUrl: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {},
}));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: addMock }) }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: auditMock }));

import { persistUploadedDocument } from '@/lib/services/documents/upload-core';

/**
 * `У-251` — запись новой версии загруженного документа.
 *
 * Здесь проверяется ровно то, чего не видно снаружи: обе записи идут одной
 * транзакцией, прежняя версия помечается заменённой, а журнал отличает замену
 * от новой бумаги. Обычная загрузка при этом остаётся одной записью — без
 * транзакции, которая держала бы соединение на каждом файле впустую.
 */
const baseArgs = {
  counterparty: { type: 'organization' as const, id: 'org-1' },
  orderId: 'order-1',
  direction: 'incoming' as const,
  docType: 'act',
  uploadedById: 'user-1',
  source: 'organization' as const,
  file: { name: 'a.pdf', size: 10, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
};

function makePrisma() {
  const create = vi.fn().mockResolvedValue({ id: 'doc-new' });
  const update = vi.fn().mockResolvedValue({});
  const tx = { document: { create, update } };
  const transaction = vi.fn((fn: (t: typeof tx) => unknown) => fn(tx));
  const prisma = {
    document: { create, update },
    order: { findUnique: vi.fn().mockResolvedValue({ companyId: 'co-order' }) },
    $transaction: transaction,
  } as never;
  return { prisma, create, update, transaction };
}

describe('persistUploadedDocument — новая версия (У-251)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMock.mockResolvedValue(undefined);
  });

  it('обычная загрузка транзакцию не открывает', async () => {
    const { prisma, create, transaction } = makePrisma();
    const r = await persistUploadedDocument(prisma, baseArgs);
    expect(r).toMatchObject({ ok: true, documentId: 'doc-new' });
    expect(transaction).not.toHaveBeenCalled();
    expect(create.mock.calls[0]![0].data.replacesDocumentId).toBeUndefined();
    expect(auditMock.mock.calls[0]![1].action).toBe('document_uploaded');
  });

  it('замена пишет ссылку, следующий номер и помечает прежнюю — одной транзакцией', async () => {
    const { prisma, create, update, transaction } = makePrisma();
    const r = await persistUploadedDocument(prisma, {
      ...baseArgs,
      replaces: { id: 'doc-old', version: 2 },
    });

    expect(r).toMatchObject({ ok: true, documentId: 'doc-new' });
    expect(transaction).toHaveBeenCalledOnce();

    const data = create.mock.calls[0]![0].data;
    expect(data.replacesDocumentId).toBe('doc-old');
    expect(data.version).toBe(3);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-old' },
        data: expect.objectContaining({ supersededAt: expect.any(Date) }),
      })
    );
  });

  it('журнал отличает замену версии от новой бумаги', async () => {
    const { prisma } = makePrisma();
    await persistUploadedDocument(prisma, {
      ...baseArgs,
      replaces: { id: 'doc-old', version: 2 },
    });
    const rec = auditMock.mock.calls[0]![1];
    expect(rec.action).toBe('document_version_uploaded');
    expect(rec.after).toMatchObject({ replacesDocumentId: 'doc-old', version: 3 });
  });
});
