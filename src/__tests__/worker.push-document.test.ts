import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import type { PushDocumentJobPayload } from '@/lib/jobs/types';

/**
 * `У-174` — «человек узнаёт об ошибке выгрузки». Prisma-фейк, unit-слой:
 * кому и когда уходит уведомление после окончательного отказа. Основной
 * путь процессора на живом Postgres — worker.push-document.integration.test.ts.
 */
const { pushDocumentToOneC, primeIntegrationSettingsCache } = vi.hoisted(() => ({
  pushDocumentToOneC: vi.fn(),
  primeIntegrationSettingsCache: vi.fn(),
}));
vi.mock('@/lib/services/oneCSync/pushDocument', () => ({ pushDocumentToOneC }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ primeIntegrationSettingsCache }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import {
  pushDocumentProcessor,
  handlePushDocumentJobFailed,
  notifyPushDocumentFinalFailure,
} from '@/worker/processors/push-document';
import { log } from '@/lib/logging';

const DOC = { type: 'act', number: 'А-7', companyId: 'co-1', oneCPushAttempts: 5 };

function makeDb(
  doc: Record<string, unknown> | null = DOC,
  users: Array<{ id: string; role: string }> = [
    { id: 'lead-1', role: 'leader' },
    { id: 'mgr-1', role: 'manager' },
  ]
) {
  const findUnique = vi.fn().mockResolvedValue(doc);
  const findMany = vi.fn().mockResolvedValue(users);
  const create = vi.fn((args: unknown) => args);
  const $transaction = vi.fn(async (ops: unknown[]) => ops);
  const db = {
    document: { findUnique },
    user: { findMany },
    notification: { create },
    $transaction,
  } as unknown as PrismaClient;
  return { db, findUnique, findMany, create, $transaction };
}

function job(
  data: PushDocumentJobPayload,
  over: { attemptsMade?: number; attempts?: number } = {}
): Job<PushDocumentJobPayload> {
  return {
    id: 'j-1',
    data,
    attemptsMade: over.attemptsMade,
    opts: over.attempts === undefined ? {} : { attempts: over.attempts },
  } as unknown as Job<PushDocumentJobPayload>;
}

/** Тела созданных уведомлений — `create` возвращает свои аргументы. */
function created(create: ReturnType<typeof vi.fn>) {
  return create.mock.calls.map((c) => c[0].data);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(log, 'info').mockImplementation(() => {});
  vi.spyOn(log, 'warn').mockImplementation(() => {});
  primeIntegrationSettingsCache.mockResolvedValue(undefined);
});

describe('notifyPushDocumentFinalFailure — кому и что', () => {
  it('руководителям компании и инициатору: одна запись на человека, ссылка — в его кабинет', async () => {
    const { db, findMany, create, $transaction } = makeDb();
    await notifyPushDocumentFinalFailure(db, {
      documentId: 'doc-1',
      errorMessage: 'Контрагент не найден',
      actorUserId: 'mgr-1',
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [{ role: 'leader', companyId: 'co-1' }, { id: 'mgr-1' }],
      },
      select: { id: true, role: true },
    });
    expect($transaction).toHaveBeenCalledTimes(1);
    const rows = created(create);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      userId: 'lead-1',
      type: 'sync_error',
      title: 'Не удалось выгрузить документ в 1С',
      body: 'Акт А-7 не принят 1С после 5 попыток: Контрагент не найден. Откройте документ и нажмите «Повторить» или исправьте его.',
      meta: {
        kind: 'push_document_failed',
        documentId: 'doc-1',
        error: 'Контрагент не найден',
        url: '/leader/documents/doc-1',
      },
    });
    expect(rows[1].userId).toBe('mgr-1');
    expect(rows[1].meta.url).toBe('/manager/documents/doc-1');
  });

  it('админ-инициатор получает ссылку на зеркало /admin', async () => {
    const { db, create } = makeDb(DOC, [{ id: 'adm-1', role: 'admin' }]);
    await notifyPushDocumentFinalFailure(db, {
      documentId: 'doc-1',
      errorMessage: 'x',
      actorUserId: 'adm-1',
    });
    expect(created(create)[0].meta.url).toBe('/admin/documents/doc-1');
  });

  it('без попыток и без номера — «Документ без номера не принят 1С: …», без счётчика', async () => {
    const { db, create } = makeDb({
      type: 'other',
      number: null,
      companyId: 'co-1',
      oneCPushAttempts: 0,
    });
    await notifyPushDocumentFinalFailure(db, { documentId: 'doc-1', errorMessage: 'нет номера' });
    expect(created(create)[0].body).toBe(
      'Документ без номера не принят 1С: нет номера. Откройте документ и нажмите «Повторить» или исправьте его.'
    );
  });

  it.each([
    [1, 'после 1 попытки'],
    [2, 'после 2 попыток'],
    [11, 'после 11 попыток'],
  ])('склонение: %s → «%s»', async (n, text) => {
    const { db, create } = makeDb({ ...DOC, oneCPushAttempts: n });
    await notifyPushDocumentFinalFailure(db, { documentId: 'doc-1', errorMessage: 'x' });
    expect(created(create)[0].body).toContain(text);
  });

  it('документ без компании — только инициатору (legacy-строки)', async () => {
    const { db, findMany } = makeDb({ ...DOC, companyId: null });
    await notifyPushDocumentFinalFailure(db, {
      documentId: 'doc-1',
      errorMessage: 'x',
      actorUserId: 'mgr-1',
    });
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ id: 'mgr-1' }]);
  });

  it('ни компании, ни инициатора — некого звать: пользователей не читаем', async () => {
    const { db, findMany, $transaction } = makeDb({ ...DOC, companyId: null });
    await notifyPushDocumentFinalFailure(db, { documentId: 'doc-1', errorMessage: 'x' });
    expect(findMany).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it('документа нет — тихо выходим', async () => {
    const { db, findMany } = makeDb(null);
    await notifyPushDocumentFinalFailure(db, { documentId: 'ghost', errorMessage: 'x' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('получатели не нашлись (все выключены) — записей нет', async () => {
    const { db, $transaction } = makeDb(DOC, []);
    await notifyPushDocumentFinalFailure(db, { documentId: 'doc-1', errorMessage: 'x' });
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('handlePushDocumentJobFailed — только после последней попытки', () => {
  it('без задачи (событие очереди без job) — ничего', async () => {
    const { db, findUnique } = makeDb();
    await handlePushDocumentJobFailed(db, undefined, new Error('x'));
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('попытки ещё остались — очередь повторит сама, уведомления нет', async () => {
    const { db, findUnique } = makeDb();
    await handlePushDocumentJobFailed(
      db,
      job({ documentId: 'doc-1' }, { attemptsMade: 2, attempts: 5 }),
      new Error('x')
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('последняя попытка — уведомление с текстом ошибки и инициатором задачи', async () => {
    const { db, create } = makeDb();
    await handlePushDocumentJobFailed(
      db,
      job({ documentId: 'doc-1', actorUserId: 'mgr-1' }, { attemptsMade: 5, attempts: 5 }),
      new Error('1С: таймаут')
    );
    const rows = created(create);
    expect(rows).toHaveLength(2);
    expect(rows[0].meta.error).toBe('1С: таймаут');
    expect(rows[0].body).toContain('после 5 попыток: 1С: таймаут');
  });

  it('без attempts в opts задача одноразовая: первый же сбой — последний', async () => {
    const { db, create } = makeDb();
    await handlePushDocumentJobFailed(
      db,
      job({ documentId: 'doc-1' }, { attemptsMade: 1 }),
      new Error('x')
    );
    expect(created(create)).toHaveLength(2);
  });

  it('attemptsMade не задан — считается 0: при attempts > 0 уведомления нет', async () => {
    const { db, findUnique } = makeDb();
    await handlePushDocumentJobFailed(
      db,
      job({ documentId: 'doc-1' }, { attempts: 5 }),
      new Error('x')
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('сбой самого уведомления — в лог, наружу не бросает', async () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => {});
    const { db, findUnique } = makeDb();
    findUnique.mockRejectedValueOnce(new Error('db gone'));
    await expect(
      handlePushDocumentJobFailed(
        db,
        job({ documentId: 'doc-1' }, { attemptsMade: 5, attempts: 5 }),
        new Error('x')
      )
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      '[worker] notifyPushDocumentFinalFailure failed',
      expect.objectContaining({ message: 'db gone' })
    );
    error.mockRestore();
  });
});

describe('pushDocumentProcessor — отказы, которые очередь не повторит', () => {
  it.each(['counterparty_without_inn', 'no_number'] as const)(
    '%s — документ ждёт человека: уведомление сразу, русским текстом',
    async (error) => {
      pushDocumentToOneC.mockResolvedValue({ ok: false, error });
      const { db, create } = makeDb();
      const res = await pushDocumentProcessor(
        job({ documentId: 'doc-1', actorUserId: 'mgr-1' }),
        db
      );
      expect(res).toEqual({ documentId: 'doc-1', outcome: error });
      const rows = created(create);
      expect(rows).toHaveLength(2);
      expect(rows[0].meta.error).not.toBe(error);
      expect(rows[0].meta.error).toMatch(/[а-яё]/i);
    }
  );

  it.each(['not_pushable_type', 'superseded', 'not_found'] as const)(
    '%s — документ не в failed, уведомлять некого и не о чем',
    async (error) => {
      pushDocumentToOneC.mockResolvedValue({ ok: false, error });
      const { db, findUnique } = makeDb();
      const res = await pushDocumentProcessor(job({ documentId: 'doc-1' }), db);
      expect(res).toEqual({ documentId: 'doc-1', outcome: error });
      expect(findUnique).not.toHaveBeenCalled();
    }
  );

  it('push_failed — исключение наружу для повтора, уведомление отложено до последней попытки', async () => {
    pushDocumentToOneC.mockResolvedValue({ ok: false, error: 'push_failed', message: 'boom' });
    const { db, findUnique } = makeDb();
    await expect(pushDocumentProcessor(job({ documentId: 'doc-1' }), db)).rejects.toThrow('boom');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('сбой уведомления не меняет исход задачи — только запись в лог', async () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => {});
    pushDocumentToOneC.mockResolvedValue({ ok: false, error: 'no_number' });
    const { db, findUnique } = makeDb();
    findUnique.mockRejectedValueOnce(new Error('db gone'));
    const res = await pushDocumentProcessor(job({ documentId: 'doc-1' }), db);
    expect(res).toEqual({ documentId: 'doc-1', outcome: 'no_number' });
    expect(error).toHaveBeenCalledWith(
      '[worker] notifyPushDocumentFinalFailure failed',
      expect.objectContaining({ message: 'db gone' })
    );
    error.mockRestore();
  });

  it('успех и «та же версия» — без уведомлений', async () => {
    const { db, findUnique } = makeDb();
    pushDocumentToOneC.mockResolvedValueOnce({ ok: true, oneCExternalId: '1c', skipped: null });
    expect(await pushDocumentProcessor(job({ documentId: 'doc-1' }), db)).toEqual({
      documentId: 'doc-1',
      outcome: 'pushed',
    });
    pushDocumentToOneC.mockResolvedValueOnce({
      ok: true,
      oneCExternalId: '1c',
      skipped: 'same_version',
    });
    expect(await pushDocumentProcessor(job({ documentId: 'doc-1' }), db)).toEqual({
      documentId: 'doc-1',
      outcome: 'same_version',
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(primeIntegrationSettingsCache).toHaveBeenCalledWith(db);
  });
});
