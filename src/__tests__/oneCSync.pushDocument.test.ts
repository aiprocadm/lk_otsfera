import { describe, it, expect, vi, beforeEach } from 'vitest';

// Краевые ветки `pushDocumentToOneC`/`enqueueDocumentPush` на подставной
// Prisma (этап 8, PR-3). Основной путь на живом Postgres —
// worker.push-document.integration.test.ts.
const { writeSyncLog, getOneCAdapter, recordAudit, createSignedUrl, queueAdd, getQueue } =
  vi.hoisted(() => {
    const queueAdd = vi.fn();
    return {
      writeSyncLog: vi.fn(),
      getOneCAdapter: vi.fn(),
      recordAudit: vi.fn(),
      createSignedUrl: vi.fn(async () => 'https://s3.test/file.pdf'),
      queueAdd,
      getQueue: vi.fn(() => ({ add: queueAdd })),
    };
  });
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));
vi.mock('@/lib/services/oneCSync/index', () => ({ getOneCAdapter }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ createSignedUrl }) }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { pushDocumentToOneC, enqueueDocumentPush } from '@/lib/services/oneCSync/pushDocument';
import type { OneCAdapter } from '@/lib/services/oneCSync';
import type { OneCDocumentPushPayload } from '@/lib/services/oneCSync/dto';
import { log } from '@/lib/logging';

type Prisma = Parameters<typeof pushDocumentToOneC>[0];

const dec = (n: number) => ({ toNumber: () => n });

const baseDoc = {
  id: 'doc-1',
  type: 'invoice',
  number: 'С-1',
  version: 1,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  path: 'documents/doc-1.pdf',
  supersededAt: null,
  replacesDocumentId: null,
  counterpartyType: 'organization',
  counterpartyId: 'org-1',
  uploadedById: 'user-1',
  oneCPushStatus: 'none',
  oneCPushedVersion: null,
  oneCExternalId: null,
  amountNet: dec(100),
  amountVat: dec(20),
  amountGross: dec(120),
  order: null,
  parentDocument: null,
  lines: [],
};

const org = { inn: '7707083893', kpp: null, name: 'Орг', legalName: null };

function makePrisma(docOverride: Record<string, unknown> = {}) {
  const doc = { ...baseDoc, ...docOverride };
  return {
    document: {
      findUnique: vi.fn().mockResolvedValue(doc),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn().mockResolvedValue(doc),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    organization: { findUnique: vi.fn().mockResolvedValue(org) },
    partner: { findUnique: vi.fn().mockResolvedValue({ ...org, name: 'Партнёр' }) },
  } as unknown as Prisma & {
    document: Record<'findUnique' | 'findUniqueOrThrow' | 'update' | 'updateMany', ReturnType<typeof vi.fn>>;
    organization: { findUnique: ReturnType<typeof vi.fn> };
    partner: { findUnique: ReturnType<typeof vi.fn> };
  };
}

function adapter(impl?: (p: OneCDocumentPushPayload) => Promise<{ externalId: string }>) {
  const pushDocument = vi.fn(impl ?? (async () => ({ externalId: '1c-1' })));
  return { adapter: { pushDocument } as unknown as OneCAdapter, pushDocument };
}

beforeEach(() => {
  vi.clearAllMocks();
  writeSyncLog.mockResolvedValue(undefined);
  recordAudit.mockResolvedValue(undefined);
});

describe('pushDocumentToOneC — краевые ветки', () => {
  it('падение записи аудита не отменяет выгрузку: результат ok, ошибка в логе', async () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => {});
    recordAudit.mockRejectedValueOnce(new Error('audit table locked'));
    const prisma = makePrisma();
    const res = await pushDocumentToOneC(prisma, 'doc-1', { adapter: adapter().adapter });
    expect(res).toEqual({ ok: true, oneCExternalId: '1c-1', skipped: null });
    expect(error).toHaveBeenCalledWith('[pushDocumentToOneC] audit write failed', {
      documentId: 'doc-1',
      error: 'audit table locked',
    });
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ oneCPushStatus: 'pushed' }) })
    );
    error.mockRestore();
  });

  it('без актора и без автора документа аудит не пишется, выгрузка проходит', async () => {
    const prisma = makePrisma({ uploadedById: null });
    const res = await pushDocumentToOneC(prisma, 'doc-1', { adapter: adapter().adapter });
    expect(res.ok).toBe(true);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', status: 'success' }),
      prisma
    );
  });

  it('актор важнее автора: аудит от actorUserId', async () => {
    const prisma = makePrisma();
    await pushDocumentToOneC(prisma, 'doc-1', { adapter: adapter().adapter, actorUserId: 'u-9' });
    expect(recordAudit).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ userId: 'u-9', action: 'document_pushed_to_1c' })
    );
  });

  it('без opts.adapter берётся настроенный getOneCAdapter()', async () => {
    const { adapter: a, pushDocument } = adapter();
    getOneCAdapter.mockReturnValueOnce(a);
    const res = await pushDocumentToOneC(makePrisma(), 'doc-1');
    expect(res.ok).toBe(true);
    expect(pushDocument).toHaveBeenCalledTimes(1);
  });

  it('цепочка перевыпусков глубже 100 — исключение, а не вечный цикл', async () => {
    const prisma = makePrisma({ replacesDocumentId: 'prev' });
    prisma.document.findUniqueOrThrow.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      replacesDocumentId: `${where.id}-prev`,
    }));
    await expect(
      pushDocumentToOneC(prisma, 'doc-1', { adapter: adapter().adapter })
    ).rejects.toThrow(/deeper than 100/);
  });

  it('адаптер бросил не-Error — текст через String()', async () => {
    const prisma = makePrisma();
    const res = await pushDocumentToOneC(prisma, 'doc-1', {
      adapter: adapter(async () => {
        throw 'socket hang up';
      }).adapter,
    });
    expect(res).toEqual({ ok: false, error: 'push_failed', message: 'socket hang up' });
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ oneCPushError: 'socket hang up' }) })
    );
  });

  it('основание без номера — parentDocument: null, корень цепочки не ищется', async () => {
    const prisma = makePrisma({
      type: 'act',
      parentDocument: { id: 'p-1', number: null, replacesDocumentId: null },
    });
    const { adapter: a, pushDocument } = adapter();
    await pushDocumentToOneC(prisma, 'doc-1', { adapter: a });
    expect(pushDocument.mock.calls[0][0].parentDocument).toBeNull();
    expect(prisma.document.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('контрагент-партнёр читается из partner, строки уезжают с русскими единицами', async () => {
    const prisma = makePrisma({
      counterpartyType: 'partner',
      counterpartyId: 'p-1',
      lines: [
        {
          title: 'Услуга',
          quantity: dec(2),
          unit: 'hour',
          unitPrice: dec(50),
          vatRate: null,
          vatAmount: dec(0),
          amount: dec(100),
        },
      ],
    });
    const { adapter: a, pushDocument } = adapter();
    await pushDocumentToOneC(prisma, 'doc-1', { adapter: a });
    expect(prisma.partner.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p-1' } })
    );
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    const body = pushDocument.mock.calls[0][0] as OneCDocumentPushPayload;
    expect(body.counterparty?.name).toBe('Партнёр');
    expect(body.lines).toEqual([
      { title: 'Услуга', quantity: 2, unit: 'час', price: 50, vatRate: null, vatAmount: 0, amount: 100 },
    ]);
  });

  it('документ без контрагента — counterparty_without_inn, справочники не читаются', async () => {
    const prisma = makePrisma({ counterpartyType: null, counterpartyId: null });
    const res = await pushDocumentToOneC(prisma, 'doc-1', { adapter: adapter().adapter });
    expect(res).toEqual({ ok: false, error: 'counterparty_without_inn' });
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.partner.findUnique).not.toHaveBeenCalled();
  });

  it('повтор по документу, который 1С уже знает, — операция update даже без перевыпуска', async () => {
    const prisma = makePrisma({ oneCPushStatus: 'failed', oneCExternalId: '1c-old' });
    await pushDocumentToOneC(prisma, 'doc-1', { adapter: adapter().adapter });
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'update', status: 'success' }),
      prisma
    );
  });

  it('несуществующий документ — not_found и след в SyncLog', async () => {
    const prisma = makePrisma();
    prisma.document.findUnique.mockResolvedValueOnce(null);
    const res = await pushDocumentToOneC(prisma, 'ghost', { adapter: adapter().adapter });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'ghost', errorMessage: 'Document not found' }),
      prisma
    );
  });
});

describe('enqueueDocumentPush — краевые ветки', () => {
  it('очередь упала и откат статуса тоже — обе ошибки в логе, документ остаётся pending', async () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => {});
    const prisma = makePrisma();
    queueAdd.mockRejectedValueOnce('redis closed');
    prisma.document.update.mockRejectedValueOnce(new Error('db gone'));
    const res = await enqueueDocumentPush(prisma, 'doc-1');
    expect(res).toEqual({ ok: false, error: 'queue_unavailable' });
    expect(error).toHaveBeenNthCalledWith(1, '[oneCSync] document push enqueue failed', {
      documentId: 'doc-1',
      error: 'redis closed',
    });
    expect(error).toHaveBeenNthCalledWith(
      2,
      '[oneCSync] document push status rollback failed — document left pending',
      { documentId: 'doc-1', error: 'db gone' }
    );
    error.mockRestore();
  });

  it('откат при сбое очереди бросил не-Error — текст через String()', async () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => {});
    const prisma = makePrisma();
    queueAdd.mockRejectedValueOnce(new Error('boom'));
    prisma.document.update.mockRejectedValueOnce('db string error');
    await enqueueDocumentPush(prisma, 'doc-1');
    expect(error).toHaveBeenLastCalledWith(expect.any(String), {
      documentId: 'doc-1',
      error: 'db string error',
    });
    error.mockRestore();
  });

  it('успешная постановка: pending заявлен атомарно, задача без jobId', async () => {
    const prisma = makePrisma();
    queueAdd.mockResolvedValueOnce({ id: 'j' });
    expect(await enqueueDocumentPush(prisma, 'doc-1', { actorUserId: 'u-1' })).toEqual({ ok: true });
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'doc-1', oneCPushStatus: { not: 'pending' } },
      data: { oneCPushStatus: 'pending' },
    });
    expect(queueAdd).toHaveBeenCalledWith('push', { documentId: 'doc-1', actorUserId: 'u-1' });
  });
});
