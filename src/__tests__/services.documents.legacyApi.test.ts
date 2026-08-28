import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Аудит A1: доменный слой legacy-роутов документов —
 * `uploadAdminDocument` (POST /api/documents/upload),
 * `getDocumentForSignedDownload` (POST /api/documents/[id]/download),
 * `listAllDocuments` (GET /api/documents).
 * Проверяются коды результата и порядок проверок; HTTP — в тестах роутов.
 */

const {
  canReadOrder,
  canReadDocument,
  upload,
  enqueueAdd,
  notifyDocumentCreated,
  deliver,
  getPrimaryOrg,
} = vi.hoisted(() => ({
  canReadOrder: vi.fn(),
  canReadDocument: vi.fn(),
  upload: vi.fn(),
  enqueueAdd: vi.fn(),
  notifyDocumentCreated: vi.fn(),
  deliver: vi.fn(),
  getPrimaryOrg: vi.fn(),
}));

vi.mock('@/lib/auth/policy', () => ({ canReadOrder, canReadDocument }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload,
    createSignedUrl: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }),
}));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: enqueueAdd }),
  QUEUE_NAMES: ['docs.scanDocument'],
}));
vi.mock('@/lib/notifications', () => ({
  notifyDocumentCreated,
  deliverNotificationToUser: deliver,
}));
vi.mock('@/lib/auth/organization', () => ({ getPrimaryOrganizationId: getPrimaryOrg }));

import { uploadAdminDocument } from '@/lib/services/documents/adminUpload';
import { getDocumentForSignedDownload } from '@/lib/services/documents/download';
import { listAllDocuments } from '@/lib/services/documents/list';

const admin = { sub: 'a1', role: 'admin', partnerId: null } as never;
const PDF = Buffer.from('%PDF-1.4 minimal');
const file = { name: 'good.pdf', size: PDF.length, mimeType: 'application/pdf', buffer: PDF };
const args = { orderId: 'ord1', correlationId: 'cid-1', file };

function db(over: Record<string, unknown> = {}) {
  return {
    order: {
      findUnique: vi.fn().mockResolvedValue({ id: 'ord1', companyId: 'c1', organizationId: 'o1' }),
    },
    organization: { findFirst: vi.fn().mockResolvedValue({ id: 'o1', partnerId: 'p1' }) },
    document: {
      create: vi.fn().mockResolvedValue({
        id: 'd1',
        name: 'good.pdf',
        mimeType: 'application/pdf',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  canReadOrder.mockResolvedValue(true);
  canReadDocument.mockResolvedValue(true);
  upload.mockResolvedValue(undefined);
  enqueueAdd.mockResolvedValue(undefined);
  notifyDocumentCreated.mockResolvedValue({ id: 'notif-1' });
  deliver.mockResolvedValue({});
  getPrimaryOrg.mockResolvedValue('o1');
});

describe('uploadAdminDocument', () => {
  it('пишет документ в организационный канал, ставит скан и шлёт уведомление', async () => {
    const prisma = db();
    const res = await uploadAdminDocument(prisma as never, admin, args);

    expect(res).toMatchObject({ ok: true, document: { id: 'd1', name: 'good.pdf' } });
    const created = prisma.document.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      orderId: 'ord1',
      counterpartyType: 'organization',
      counterpartyId: 'o1',
      uploadedById: 'a1',
    });
    // Путь пришпилен к тенанту: партнёр/организация/заказ.
    expect(created.path).toMatch(/^partner\/p1\/org\/o1\/order\/ord1\//);
    expect(upload).toHaveBeenCalledWith(created.path, PDF, { contentType: 'application/pdf' });
    expect(enqueueAdd).toHaveBeenCalledWith('scan', { kind: 'document', id: 'd1' });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('нет заказа → not_found (до любых проверок доступа)', async () => {
    const prisma = db({ order: { findUnique: vi.fn().mockResolvedValue(null) } });
    expect(await uploadAdminDocument(prisma as never, admin, args)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(canReadOrder).not.toHaveBeenCalled();
  });

  it('чужой заказ → forbidden, файл в хранилище не уходит', async () => {
    canReadOrder.mockResolvedValue(false);
    const prisma = db();
    expect(await uploadAdminDocument(prisma as never, admin, args)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('нет организации у компании заказа → organization_context_not_found', async () => {
    const prisma = db({ organization: { findFirst: vi.fn().mockResolvedValue(null) } });
    expect(await uploadAdminDocument(prisma as never, admin, args)).toEqual({
      ok: false,
      error: 'organization_context_not_found',
    });
  });

  it('подмена magic bytes → invalid_file_format ПОСЛЕ проверки доступа', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const prisma = db();
    const res = await uploadAdminDocument(prisma as never, admin, {
      ...args,
      file: { ...file, buffer: png, size: png.length },
    });
    expect(res).toEqual({ ok: false, error: 'invalid_file_format' });
    expect(canReadOrder).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('сбой хранилища → storage, строка документа не создаётся', async () => {
    upload.mockRejectedValue(new Error('bucket full'));
    const prisma = db();
    expect(await uploadAdminDocument(prisma as never, admin, args)).toEqual({
      ok: false,
      error: 'storage',
    });
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it('сессия без partnerId: ключ не подставляется в уведомление (exactOptionalPropertyTypes)', async () => {
    await uploadAdminDocument(db() as never, { sub: 'a1', role: 'admin' } as never, args);
    expect(notifyDocumentCreated).toHaveBeenCalledWith(
      expect.not.objectContaining({ partnerId: expect.anything() })
    );
  });

  it('сбои очереди и рассылки не ломают загрузку (graceful)', async () => {
    enqueueAdd.mockRejectedValue(new Error('Redis down'));
    notifyDocumentCreated.mockRejectedValue('transport string');
    const res = await uploadAdminDocument(db() as never, admin, args);
    expect(res).toMatchObject({ ok: true });
  });
});

describe('getDocumentForSignedDownload', () => {
  const row = {
    id: 'd1',
    path: 'p/d1.pdf',
    name: 'd1.pdf',
    scanStatus: 'clean',
    scanReason: null,
    orderId: 'ord1',
    companyId: 'c1',
    counterpartyType: 'organization',
    counterpartyId: 'o1',
    order: { companyId: 'c1' },
  };

  it('чистый документ в скоупе → путь и имя для подписи', async () => {
    const prisma = db({ document: { findUnique: vi.fn().mockResolvedValue(row) } });
    expect(await getDocumentForSignedDownload(prisma as never, admin, 'd1')).toEqual({
      ok: true,
      id: 'd1',
      path: 'p/d1.pdf',
      name: 'd1.pdf',
      // `У-154`: у документа без номера имя файла остаётся своим.
      downloadName: 'd1.pdf',
    });
  });

  it('нет строки → not_found; вне скоупа → forbidden', async () => {
    expect(await getDocumentForSignedDownload(db() as never, admin, 'd1')).toEqual({
      ok: false,
      error: 'not_found',
    });

    canReadDocument.mockResolvedValue(false);
    const prisma = db({ document: { findUnique: vi.fn().mockResolvedValue(row) } });
    expect(await getDocumentForSignedDownload(prisma as never, admin, 'd1')).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('заражённый файл: карантин для всех, кроме админа (расследование)', async () => {
    const infected = { ...row, scanStatus: 'infected', scanReason: 'EICAR' };
    const prisma = db({ document: { findUnique: vi.fn().mockResolvedValue(infected) } });
    const partner = { sub: 'u', role: 'partner', partnerId: 'p1' } as never;

    expect(await getDocumentForSignedDownload(prisma as never, partner, 'd1')).toEqual({
      ok: false,
      error: 'infected',
      scanReason: 'EICAR',
    });
    expect(await getDocumentForSignedDownload(prisma as never, admin, 'd1')).toMatchObject({
      ok: true,
    });
  });
});

describe('listAllDocuments', () => {
  it('админ видит всё, остальные — без заражённых', async () => {
    const prisma = db();
    await listAllDocuments(prisma as never, admin);
    expect(prisma.document.findMany.mock.calls[0][0].where).toEqual({});

    await listAllDocuments(prisma as never, { sub: 'u', role: 'manager' } as never);
    expect(prisma.document.findMany.mock.calls[1][0].where).toEqual({
      scanStatus: { not: 'infected' },
    });
  });
});
