/**
 * `У-251`, `У-254` (этап 8) — история документа для карточки сотрудника.
 *
 * Два инварианта: клиентские роли сюда не проходят вовсе, а старые записи
 * журнала (без роли и версии) читаются осторожно и не роняют карточку.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { canReadDocument, getVersionChain } = vi.hoisted(() => ({
  canReadDocument: vi.fn(),
  getVersionChain: vi.fn(),
}));
vi.mock('@/lib/auth/policy', () => ({ canReadDocument }));
vi.mock('@/lib/services/documents/versions', () => ({ getVersionChain }));

import { getDocumentHistory } from '@/lib/services/documents/history';

const manager = { sub: 'u1', role: 'manager' } as SessionPayload;
const admin = { sub: 'u9', role: 'admin' } as SessionPayload;
const client = { sub: 'u2', role: 'organization' } as SessionPayload;

const DOC = {
  id: 'doc2',
  type: 'invoice',
  status: 'issued',
  direction: 'outgoing',
  companyId: null,
  counterpartyType: 'organization',
  counterpartyId: 'org1',
  orderId: 'ord1',
  number: null,
  createdAt: new Date('2026-09-05T00:00:00Z'),
  generatedBy: 'user',
  replacesDocumentId: null as string | null,
  order: { companyId: 'co1' },
};

function db(opts: { doc?: unknown; events?: unknown[]; previous?: unknown }) {
  // `?? DOC` здесь не годится: тест «документа нет» передаёт именно `null`,
  // и оператор подставил бы фикстуру вместо пустоты.
  const doc = 'doc' in opts ? opts.doc : DOC;
  const findUnique = vi.fn(({ where }: { where: { id: string } }) =>
    Promise.resolve(where.id === 'doc2' ? doc : (opts.previous ?? null))
  );
  return {
    document: { findUnique },
    auditLog: { findMany: vi.fn().mockResolvedValue(opts.events ?? []) },
  } as unknown as PrismaClient;
}

describe('getDocumentHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canReadDocument.mockResolvedValue(true);
    getVersionChain.mockResolvedValue([]);
  });

  it('заказчику и партнёру история не отдаётся', async () => {
    const prisma = db({});
    expect(await getDocumentHistory(prisma, client, 'doc2')).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await getDocumentHistory(prisma, { role: 'partner' } as SessionPayload, 'doc2')).toEqual(
      { ok: false, error: 'forbidden' }
    );
    // Отказ до базы: запроса быть не должно.
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });

  it('документа нет — not_found', async () => {
    const prisma = db({ doc: null });
    expect(await getDocumentHistory(prisma, manager, 'doc2')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('документ вне скоупа отвечает тем же not_found, что и отсутствие', async () => {
    canReadDocument.mockResolvedValue(false);
    expect(await getDocumentHistory(db({}), manager, 'doc2')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('цепочка из одной версии историей не считается', async () => {
    getVersionChain.mockResolvedValue([{ id: 'doc2', version: 1 }]);
    const res = await getDocumentHistory(db({}), manager, 'doc2');
    expect(res.ok && res.history.versions).toEqual([]);
  });

  it('цепочка из двух версий и больше показывается целиком', async () => {
    getVersionChain.mockResolvedValue([
      { id: 'd1', version: 1 },
      { id: 'doc2', version: 2 },
    ]);
    const res = await getDocumentHistory(db({}), admin, 'doc2');
    expect(res.ok && res.history.versions).toHaveLength(2);
  });

  it('роль и версия читаются из журнала и переводятся на русский', async () => {
    const events = [
      {
        id: 'a1',
        createdAt: new Date('2026-09-15T10:00:00Z'),
        meta: { status: 'success', after: { ttl: 600, viewer: 'leader', version: 3 } },
        user: { name: 'Петров', email: 'p@t.local' },
      },
    ];
    const res = await getDocumentHistory(db({ events }), manager, 'doc2');
    expect(res.ok && res.history.downloads[0]).toMatchObject({
      userName: 'Петров',
      roleLabel: 'Руководитель',
      version: 3,
    });
  });

  it('старая запись без роли и версии читается без падения', async () => {
    const events = [
      {
        id: 'a2',
        createdAt: new Date('2026-08-01T10:00:00Z'),
        meta: { status: 'success', after: { ttl: 600 } },
        user: { name: '', email: 'p@t.local' },
      },
      // Совсем древняя строка: `meta` могла быть null или не объектом.
      { id: 'a3', createdAt: new Date('2026-07-01T10:00:00Z'), meta: null, user: null },
      { id: 'a4', createdAt: new Date('2026-07-02T10:00:00Z'), meta: ['мусор'], user: null },
      {
        id: 'a5',
        createdAt: new Date('2026-07-03T10:00:00Z'),
        meta: { after: 'строка вместо объекта' },
        user: null,
      },
    ];
    const res = await getDocumentHistory(db({ events }), manager, 'doc2');
    expect(res.ok && res.history.downloads).toHaveLength(4);
    expect(res.ok && res.history.downloads[0]).toMatchObject({
      userName: 'p@t.local',
      roleLabel: '—',
      version: null,
    });
    expect(res.ok && res.history.downloads[1]?.userName).toBeNull();
    expect(res.ok && res.history.downloads[3]?.roleLabel).toBe('—');
  });

  it('незнакомая роль показывается как есть, а не прячется', async () => {
    const events = [
      {
        id: 'a6',
        createdAt: new Date('2026-09-15T10:00:00Z'),
        meta: { after: { viewer: 'student', version: 'не число' } },
        user: { name: 'С', email: 's@t.local' },
      },
    ];
    const res = await getDocumentHistory(db({ events }), manager, 'doc2');
    expect(res.ok && res.history.downloads[0]).toMatchObject({
      roleLabel: 'student',
      version: null,
    });
  });

  it('прежняя версия уже в 1С — карточка об этом узнаёт', async () => {
    const doc = { ...DOC, replacesDocumentId: 'doc1' };
    const prisma = db({ doc, previous: { version: 2, oneCPushStatus: 'pushed' } });
    const res = await getDocumentHistory(prisma, manager, 'doc2');
    expect(res.ok && res.history.pushedVersionInOneC).toBe(2);
  });

  it('прежняя версия в 1С не уезжала — пометки нет', async () => {
    const doc = { ...DOC, replacesDocumentId: 'doc1' };
    const prisma = db({ doc, previous: { version: 2, oneCPushStatus: 'none' } });
    const res = await getDocumentHistory(prisma, manager, 'doc2');
    expect(res.ok && res.history.pushedVersionInOneC).toBeNull();
  });

  it('первый документ цепочки за прежней версией в базу не ходит', async () => {
    const prisma = db({});
    const res = await getDocumentHistory(prisma, manager, 'doc2');
    expect(res.ok && res.history.pushedVersionInOneC).toBeNull();
    expect(prisma.document.findUnique).toHaveBeenCalledTimes(1);
  });

  it('журнал спрашивается по тому же событию, что пишут роуты, и не больше 20 строк', async () => {
    const prisma = db({});
    await getDocumentHistory(prisma, manager, 'doc2');
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ action: 'document_download_signed_url' }),
        take: 20,
      })
    );
  });
});
