/**
 * Unit tests for src/lib/services/clientRequests/attachments.ts (этап 5, ФТ-1.3).
 *
 * По образцу services.partner.leadAttachments.test.ts: моки storage/queues/
 * audit/mimeValidator. Скоуп: upload/delete — только податель в
 * submitted|in_triage; list/downloadUrl — податель ИЛИ staff в
 * clientRequestScopeWhere; INFECTED-карантин и best-effort очередь скана.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const {
  reqFindFirst,
  attFindFirst,
  attFindMany,
  attCreate,
  attDelete,
  storageUpload,
  storageRemove,
  storageSigned,
  queueAdd,
  validateMagicBytes,
  extensionFor,
  recordAudit,
  logWarn,
  logError,
} = vi.hoisted(() => ({
  reqFindFirst: vi.fn(),
  attFindFirst: vi.fn(),
  attFindMany: vi.fn(),
  attCreate: vi.fn(),
  attDelete: vi.fn(),
  storageUpload: vi.fn(),
  storageRemove: vi.fn(),
  storageSigned: vi.fn(),
  queueAdd: vi.fn(),
  validateMagicBytes: vi.fn(),
  extensionFor: vi.fn(),
  recordAudit: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload: storageUpload,
    remove: storageRemove,
    createSignedUrl: storageSigned,
    download: vi.fn(),
  }),
  documentBucket: 'documents',
  StorageError: class StorageError extends Error {},
}));
vi.mock('@/lib/storage/mimeValidator', () => ({ validateMagicBytes, extensionFor }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: queueAdd }) }));
vi.mock('@/lib/services/scan/visibility', () => ({
  INFECTED_HIDDEN_WHERE: { scanStatus: { not: 'infected' } },
}));
vi.mock('@/lib/logging', () => ({
  log: { warn: logWarn, error: logError, info: vi.fn(), debug: vi.fn() },
  // `В-1`: best-effort удаление из хранилища теперь пишет warn через хелпер.
  bestEffort: (label: string) => (err: unknown) => logWarn(label, err),
}));

import {
  uploadClientRequestAttachment,
  deleteClientRequestAttachment,
  listClientRequestAttachments,
  getClientRequestAttachmentDownloadUrl,
  __testing,
} from '@/lib/services/clientRequests/attachments';

// ─── helpers ──────────────────────────────────────────────────────────────────

function prismaMock() {
  const tx = { clientRequestAttachment: { create: attCreate, delete: attDelete } };
  return {
    clientRequest: { findFirst: reqFindFirst },
    clientRequestAttachment: { findFirst: attFindFirst, findMany: attFindMany },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  } as never;
}

const SUBMITTER: SessionPayload = { sub: 'u1', role: 'partner', partnerId: 'p1' } as SessionPayload;
const MANAGER: SessionPayload = { sub: 'm1', role: 'manager', companyId: 'c1' } as SessionPayload;

const goodFile = () => ({
  buffer: new Uint8Array([1, 2, 3]),
  name: 'doc.pdf',
  declaredMimeType: 'application/pdf',
  size: 1024,
});

const input = () => ({ requestId: 'r1', file: goodFile() });

const foundRequest = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'submitted',
  submittedByUserId: 'u1',
  ...over,
});

const foundAtt = (over: Record<string, unknown> = {}) => ({
  id: 'att-1',
  name: 'doc.pdf',
  path: 'client-requests/r1/att-1.pdf',
  mimeType: 'application/pdf',
  scanStatus: 'clean',
  scanReason: null,
  createdByUserId: 'u1',
  request: { id: 'r1', status: 'submitted', submittedByUserId: 'u1' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  validateMagicBytes.mockReturnValue({ ok: true, mime: 'application/pdf' });
  extensionFor.mockReturnValue('pdf');
  storageUpload.mockResolvedValue(undefined);
  storageRemove.mockResolvedValue(undefined);
  storageSigned.mockResolvedValue('https://signed');
  attCreate.mockResolvedValue({ id: 'att-1' });
  recordAudit.mockResolvedValue(undefined);
  queueAdd.mockResolvedValue(undefined);
});

// ===========================================================================
// uploadClientRequestAttachment
// ===========================================================================

describe('uploadClientRequestAttachment', () => {
  it('NOT_FOUND если заявка вне скоупа сессии (findFirst → null)', async () => {
    reqFindFirst.mockResolvedValue(null);
    const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, input());
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    // Скоуп подателя зашит в запрос (submittedByUserId).
    expect(reqFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 'r1' }, { submittedByUserId: 'u1' }] },
      })
    );
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('FORBIDDEN для staff в скоупе (заявка видна, но податель — не он)', async () => {
    reqFindFirst.mockResolvedValue(foundRequest());
    const r = await uploadClientRequestAttachment(prismaMock(), MANAGER, input());
    expect(r).toMatchObject({ ok: false, error: 'FORBIDDEN' });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it('REQUEST_NOT_EDITABLE в converted и rejected', async () => {
    for (const status of ['converted', 'rejected'] as const) {
      reqFindFirst.mockResolvedValue(foundRequest({ status }));
      const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, input());
      expect(r).toMatchObject({ ok: false, error: 'REQUEST_NOT_EDITABLE' });
    }
  });

  it('UNSUPPORTED_MEDIA_TYPE при провале magic-bytes', async () => {
    validateMagicBytes.mockReturnValue({ ok: false, reason: 'bad magic' });
    const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, input());
    expect(r).toMatchObject({ ok: false, error: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('FILE_TOO_LARGE при превышении лимита', async () => {
    const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, {
      ...input(),
      file: { ...goodFile(), size: 999_000_000 },
    });
    expect(r).toMatchObject({ ok: false, error: 'FILE_TOO_LARGE' });
  });

  it('INVALID_FILENAME на имени из одних пробельных символов', async () => {
    const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, {
      ...input(),
      file: { ...goodFile(), name: '\t\n\r' },
    });
    expect(r).toMatchObject({ ok: false, error: 'INVALID_FILENAME' });
  });

  it('имя без расширения принимается целиком (точка в начале — не расширение)', async () => {
    // Файл может прийти без расширения или с точкой в начале («.gitignore»).
    // Отсекать «расширение» тут нельзя — иначе имя схлопнется в пустоту.
    reqFindFirst.mockResolvedValue(foundRequest());
    const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, {
      ...input(),
      file: { ...goodFile(), name: 'скан-без-расширения' },
    });
    expect(r).toMatchObject({ ok: true });
  });

  it('успех: S3-путь client-requests/<id>/, создание+аудит в транзакции, скан-очередь', async () => {
    reqFindFirst.mockResolvedValue(foundRequest({ status: 'in_triage' }));
    const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, input());
    expect(r).toEqual({ ok: true, attachment: { id: 'att-1' } });

    const [storagePath, , opts] = storageUpload.mock.calls[0] as [
      string,
      Buffer,
      { contentType: string },
    ];
    expect(storagePath).toMatch(/^client-requests\/r1\/[0-9a-f-]{36}\.pdf$/);
    expect(opts).toEqual({ contentType: 'application/pdf' });

    expect(attCreate).toHaveBeenCalledWith({
      data: {
        requestId: 'r1',
        createdByUserId: 'u1',
        name: 'doc.pdf',
        path: storagePath,
        mimeType: 'application/pdf',
        size: 1024,
      },
    });
    // Аудит внутри той же транзакции (первый аргумент — tx, не prisma).
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ clientRequestAttachment: expect.anything() }),
      expect.objectContaining({ action: 'client_request_attachment_uploaded', entityId: 'att-1' })
    );
    expect(queueAdd).toHaveBeenCalledWith('scan', {
      kind: 'client_request_attachment',
      id: 'att-1',
    });
  });

  it('сбой постановки в скан-очередь проглатывается: ok:true + log.warn', async () => {
    reqFindFirst.mockResolvedValue(foundRequest());
    queueAdd.mockRejectedValue(new Error('redis down'));
    const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, input());
    expect(r).toMatchObject({ ok: true });
    expect(logWarn).toHaveBeenCalledWith(
      '[client-request-attachments] enqueue scan failed',
      expect.objectContaining({ attachmentId: 'att-1' })
    );
  });

  it('сбой хранилища не-Error значением тоже даёт STORAGE_FAILURE с текстом в логе', async () => {
    // S3-клиент умеет отвергать промис не-Error объектом. Без String(err) в лог
    // ушло бы `providerError: undefined`, и разбирать инцидент было бы нечем.
    reqFindFirst.mockResolvedValue(foundRequest());
    storageUpload.mockRejectedValue('bucket closed');
    const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, input());
    expect(r).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
    expect(logError).toHaveBeenCalledWith(
      '[client-request-attachments] storage upload failed',
      expect.objectContaining({ providerError: 'bucket closed' })
    );
  });

  it('сбой очереди сканирования не-Error значением тоже проглатывается', async () => {
    reqFindFirst.mockResolvedValue(foundRequest());
    queueAdd.mockRejectedValue('redis closed');
    expect(await uploadClientRequestAttachment(prismaMock(), SUBMITTER, input())).toMatchObject({
      ok: true,
    });
  });

  it('STORAGE_FAILURE при ошибке storage.upload (сырое сообщение — только в лог)', async () => {
    reqFindFirst.mockResolvedValue(foundRequest());
    storageUpload.mockRejectedValue(new Error('bucket down'));
    const r = await uploadClientRequestAttachment(prismaMock(), SUBMITTER, input());
    expect(r).toMatchObject({
      ok: false,
      error: 'STORAGE_FAILURE',
      message: 'Не удалось загрузить файл',
    });
    expect(logError).toHaveBeenCalled();
  });

  it('компенсация: сбой create → storage.remove залитого объекта, ошибка пробрасывается', async () => {
    reqFindFirst.mockResolvedValue(foundRequest());
    const p = prismaMock();
    (p as { $transaction: ReturnType<typeof vi.fn> }).$transaction = vi.fn(async () => {
      throw new Error('db boom');
    });
    await expect(uploadClientRequestAttachment(p, SUBMITTER, input())).rejects.toThrow('db boom');
    expect(storageRemove).toHaveBeenCalledWith([expect.stringMatching(/^client-requests\/r1\//)]);
  });
});

// ===========================================================================
// deleteClientRequestAttachment
// ===========================================================================

describe('deleteClientRequestAttachment', () => {
  it('NOT_FOUND если вложение не найдено в скоупе', async () => {
    attFindFirst.mockResolvedValue(null);
    const r = await deleteClientRequestAttachment(prismaMock(), SUBMITTER, {
      attachmentId: 'att-1',
    });
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(attFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 'att-1' }, { request: { submittedByUserId: 'u1' } }] },
      })
    );
  });

  it('FORBIDDEN: staff в скоупе — не податель', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    const r = await deleteClientRequestAttachment(prismaMock(), MANAGER, { attachmentId: 'att-1' });
    expect(r).toMatchObject({ ok: false, error: 'FORBIDDEN' });
    expect(attDelete).not.toHaveBeenCalled();
  });

  it('статусные гейты: converted/rejected → REQUEST_NOT_EDITABLE даже для подателя', async () => {
    for (const status of ['converted', 'rejected'] as const) {
      attFindFirst.mockResolvedValue(
        foundAtt({ request: { id: 'r1', status, submittedByUserId: 'u1' } })
      );
      const r = await deleteClientRequestAttachment(prismaMock(), SUBMITTER, {
        attachmentId: 'att-1',
      });
      expect(r).toMatchObject({ ok: false, error: 'REQUEST_NOT_EDITABLE' });
    }
    expect(attDelete).not.toHaveBeenCalled();
  });

  it('успех подателя: delete+аудит в транзакции, best-effort удаление из хранилища', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    const r = await deleteClientRequestAttachment(prismaMock(), SUBMITTER, {
      attachmentId: 'att-1',
    });
    expect(r).toEqual({ ok: true });
    expect(attDelete).toHaveBeenCalledWith({ where: { id: 'att-1' } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'client_request_attachment_deleted',
        after: { requestId: 'r1', name: 'doc.pdf' },
      })
    );
    expect(storageRemove).toHaveBeenCalledWith(['client-requests/r1/att-1.pdf']);
  });

  it('сбой storage.remove проглатывается (ok:true), но уходит в warn (В-1)', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    const err = new Error('s3 down');
    storageRemove.mockRejectedValue(err);
    const r = await deleteClientRequestAttachment(prismaMock(), SUBMITTER, {
      attachmentId: 'att-1',
    });
    expect(r).toEqual({ ok: true });
    expect(logWarn).toHaveBeenCalledWith('[client-request-attachments] storage remove failed', err);
  });
});

// ===========================================================================
// getClientRequestAttachmentDownloadUrl
// ===========================================================================

describe('getClientRequestAttachmentDownloadUrl', () => {
  it('успех подателя: signed url c TTL 300 и download-именем', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    const r = await getClientRequestAttachmentDownloadUrl(prismaMock(), SUBMITTER, {
      attachmentId: 'att-1',
    });
    expect(r).toEqual({
      ok: true,
      url: 'https://signed',
      name: 'doc.pdf',
      mimeType: 'application/pdf',
    });
    expect(storageSigned).toHaveBeenCalledWith('client-requests/r1/att-1.pdf', 300, {
      download: 'doc.pdf',
    });
  });

  it('staff в скоупе тоже может скачивать (C8-скоуп в where)', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    const r = await getClientRequestAttachmentDownloadUrl(prismaMock(), MANAGER, {
      attachmentId: 'att-1',
    });
    expect(r).toMatchObject({ ok: true });
    expect(attFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { id: 'att-1' },
            { request: { OR: [{ organization: { companyId: 'c1' } }, { organizationId: null }] } },
          ],
        },
      })
    );
  });

  it('NOT_FOUND вне скоупа', async () => {
    attFindFirst.mockResolvedValue(null);
    const r = await getClientRequestAttachmentDownloadUrl(prismaMock(), SUBMITTER, {
      attachmentId: 'att-1',
    });
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('INFECTED → код INFECTED с scanReason в meta, без обращения к хранилищу', async () => {
    attFindFirst.mockResolvedValue(foundAtt({ scanStatus: 'infected', scanReason: 'EICAR-Test' }));
    const r = await getClientRequestAttachmentDownloadUrl(prismaMock(), SUBMITTER, {
      attachmentId: 'att-1',
    });
    expect(r).toMatchObject({ ok: false, error: 'INFECTED', meta: { scanReason: 'EICAR-Test' } });
    expect(storageSigned).not.toHaveBeenCalled();
  });

  it('сбой ссылки не-Error значением тоже даёт STORAGE_FAILURE', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    storageSigned.mockRejectedValue('signer closed');
    const r = await getClientRequestAttachmentDownloadUrl(prismaMock(), SUBMITTER, {
      attachmentId: 'att-1',
    });
    expect(r).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
  });

  it('STORAGE_FAILURE при сбое createSignedUrl', async () => {
    attFindFirst.mockResolvedValue(foundAtt());
    storageSigned.mockRejectedValue(new Error('no url'));
    const r = await getClientRequestAttachmentDownloadUrl(prismaMock(), SUBMITTER, {
      attachmentId: 'att-1',
    });
    expect(r).toMatchObject({ ok: false, error: 'STORAGE_FAILURE' });
  });
});

// ===========================================================================
// listClientRequestAttachments
// ===========================================================================

describe('listClientRequestAttachments', () => {
  it('NOT_FOUND если заявка вне скоупа', async () => {
    reqFindFirst.mockResolvedValue(null);
    const r = await listClientRequestAttachments(prismaMock(), SUBMITTER, { requestId: 'r1' });
    expect(r).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('карантин: INFECTED_HIDDEN_WHERE в where; маппинг строк с именем автора', async () => {
    reqFindFirst.mockResolvedValue(foundRequest());
    const dt = new Date('2026-01-01T00:00:00Z');
    attFindMany.mockResolvedValue([
      {
        id: 'a1',
        name: 'file.pdf',
        size: 1024,
        mimeType: 'application/pdf',
        createdAt: dt,
        createdByUserId: 'u1',
        createdByUser: { name: 'Иван Иванов' },
      },
      {
        id: 'a2',
        name: 'n2.pdf',
        size: 2,
        mimeType: 'application/pdf',
        createdAt: dt,
        createdByUserId: null,
        createdByUser: null,
      },
    ]);
    const r = await listClientRequestAttachments(prismaMock(), SUBMITTER, { requestId: 'r1' });
    expect(attFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId: 'r1', scanStatus: { not: 'infected' } },
        orderBy: { createdAt: 'desc' },
      })
    );
    expect(r).toEqual({
      ok: true,
      rows: [
        {
          id: 'a1',
          name: 'file.pdf',
          size: 1024,
          mimeType: 'application/pdf',
          createdAt: dt,
          createdByUserId: 'u1',
          createdByUserName: 'Иван Иванов',
        },
        expect.objectContaining({ id: 'a2', createdByUserName: null }),
      ],
    });
  });
});

// ===========================================================================
// __testing helpers
// ===========================================================================

describe('__testing', () => {
  it('редактируемые статусы — submitted и in_triage', () => {
    expect(__testing.EDITABLE_STATUSES).toEqual(['submitted', 'in_triage']);
  });
});
