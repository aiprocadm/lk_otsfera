import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { OneCAdapter } from '@/lib/services/oneCSync';

const { writeSyncLog, getOneCAdapter, getQueue, queueAdd, reissueChainRootId } = vi.hoisted(() => {
  const queueAdd = vi.fn();
  return {
    writeSyncLog: vi.fn(),
    getOneCAdapter: vi.fn(),
    queueAdd,
    getQueue: vi.fn(() => ({ add: queueAdd })),
    // Корень цепочки перевыпусков: в unit-тесте — «кого заменяю, тот и корень».
    reissueChainRootId: vi.fn(
      async (_p: unknown, doc: { id: string; replacesDocumentId: string | null }) =>
        doc.replacesDocumentId ?? doc.id
    ),
  };
});

vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));
vi.mock('@/lib/services/oneCSync/index', () => ({ getOneCAdapter }));
vi.mock('@/lib/services/oneCSync/pushDocument', () => ({ reissueChainRootId }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { reconcilePushedDocuments, reconcileStuckLeads } from '@/lib/services/oneCSync/reconcile';

/**
 * Этап 8 (`У-172`, `Д-26`) — сверка выгруженного с 1С.
 *
 * Документы: спрашиваем ровно действующие `pushed` по корню цепочки; «нет
 * такого» → `failed` с русской причиной и `error` в истории; ошибка
 * транспорта → остановка без пометок. Лиды: претензия старше суток без
 * подтверждения — один повтор, второй раз — ошибка.
 */

const NOW = new Date('2026-09-04T03:00:00Z');
const HOURS = 60 * 60 * 1000;

type Doc = {
  id: string;
  replacesDocumentId: string | null;
  version: number;
  oneCExternalId: string | null;
};

function docsPrisma(rows: Doc[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { document: { findMany, updateMany } } as unknown as PrismaClient;
  return { prisma, findMany, updateMany };
}

function adapterWith(answers: Record<string, 'found' | 'missing' | 'throw'>) {
  const findDocument = vi.fn(async (externalId: string) => {
    const a = answers[externalId];
    if (a === 'throw') throw new Error('1C responded 503');
    if (a === 'missing') return null;
    return { externalId: `1c-${externalId}` };
  });
  return { adapter: { findDocument } as unknown as OneCAdapter, findDocument };
}

beforeEach(() => {
  vi.clearAllMocks();
  getQueue.mockImplementation(() => ({ add: queueAdd }));
});

describe('reconcilePushedDocuments', () => {
  it('берёт только действующие pushed (supersededAt=null) узким select', async () => {
    const { prisma, findMany } = docsPrisma([]);
    const { adapter } = adapterWith({});
    await reconcilePushedDocuments(prisma, { adapter });
    expect(findMany).toHaveBeenCalledWith({
      where: { oneCPushStatus: 'pushed', supersededAt: null },
      select: { id: true, replacesDocumentId: true, version: true, oneCExternalId: true },
      orderBy: { id: 'asc' },
    });
  });

  it('пропавший в 1С → failed с русской причиной, error в истории; найденный не тронут', async () => {
    const { prisma, updateMany } = docsPrisma([
      { id: 'doc-ok', replacesDocumentId: null, version: 1, oneCExternalId: '1c-doc-ok' },
      { id: 'doc-lost', replacesDocumentId: null, version: 2, oneCExternalId: '1c-doc-lost' },
    ]);
    const { adapter, findDocument } = adapterWith({ 'doc-ok': 'found', 'doc-lost': 'missing' });

    const res = await reconcilePushedDocuments(prisma, { adapter });

    expect(res).toEqual({ checked: 2, missing: ['doc-lost'], unchecked: 0, error: null });
    expect(findDocument).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'doc-lost', oneCPushStatus: 'pushed' },
      data: {
        oneCPushStatus: 'failed',
        oneCPushError: 'Документ не найден в 1С при сверке — выгрузите его заново.',
      },
    });
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'document',
        direction: 'outbound',
        operation: 'check',
        status: 'error',
        externalId: 'doc-lost',
        errorMessage: 'missing_in_1c',
        payload: {
          documentId: 'doc-lost',
          externalId: 'doc-lost',
          oneCExternalId: '1c-doc-lost',
          version: 2,
        },
      }),
      prisma
    );
    // Итог прохода — warn: кого-то не нашли, но 1С отвечала.
    expect(writeSyncLog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entity: 'reconcile',
        direction: 'outbound',
        operation: 'check',
        status: 'warn',
        payload: { checked: 2, missing: ['doc-lost'], unchecked: 0 },
      }),
      prisma
    );
  });

  it('всё на месте → одна итоговая строка success, документы не трогаются', async () => {
    const { prisma, updateMany } = docsPrisma([
      { id: 'doc-1', replacesDocumentId: null, version: 1, oneCExternalId: '1c-1' },
    ]);
    const { adapter } = adapterWith({ 'doc-1': 'found' });
    const res = await reconcilePushedDocuments(prisma, { adapter });
    expect(res).toEqual({ checked: 1, missing: [], unchecked: 0, error: null });
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeSyncLog).toHaveBeenCalledTimes(1);
    expect(writeSyncLog.mock.calls[0][0]).toMatchObject({ entity: 'reconcile', status: 'success' });
  });

  it('перевыпущенный документ спрашивается по корню цепочки, а не по своему id', async () => {
    const { prisma } = docsPrisma([
      { id: 'doc-v2', replacesDocumentId: 'doc-v1', version: 2, oneCExternalId: '1c-root' },
    ]);
    const { adapter, findDocument } = adapterWith({ 'doc-v1': 'found' });
    const res = await reconcilePushedDocuments(prisma, { adapter });
    expect(findDocument).toHaveBeenCalledWith('doc-v1');
    expect(res.missing).toEqual([]);
  });

  it('ошибка транспорта — не «пропал»: обход прерывается, ничего не помечается, итог error', async () => {
    const { prisma, updateMany } = docsPrisma([
      { id: 'doc-a', replacesDocumentId: null, version: 1, oneCExternalId: '1c-a' },
      { id: 'doc-b', replacesDocumentId: null, version: 1, oneCExternalId: '1c-b' },
      { id: 'doc-c', replacesDocumentId: null, version: 1, oneCExternalId: '1c-c' },
    ]);
    const { adapter, findDocument } = adapterWith({
      'doc-a': 'found',
      'doc-b': 'throw',
      'doc-c': 'missing',
    });

    const res = await reconcilePushedDocuments(prisma, { adapter });

    expect(res).toEqual({ checked: 1, missing: [], unchecked: 2, error: '1C responded 503' });
    expect(findDocument).toHaveBeenCalledTimes(2);
    expect(updateMany).not.toHaveBeenCalled();
    expect(writeSyncLog).toHaveBeenCalledTimes(1);
    expect(writeSyncLog.mock.calls[0][0]).toMatchObject({
      entity: 'reconcile',
      status: 'error',
      errorMessage: '1C responded 503',
      payload: { checked: 1, missing: [], unchecked: 2, stoppedAt: 'doc-b' },
    });
  });

  it('не-Error из адаптера превращается в строку', async () => {
    const { prisma } = docsPrisma([
      { id: 'doc-a', replacesDocumentId: null, version: 1, oneCExternalId: '1c-a' },
    ]);
    const adapter = {
      findDocument: vi.fn().mockRejectedValue('boom'),
    } as unknown as OneCAdapter;
    const res = await reconcilePushedDocuments(prisma, { adapter });
    expect(res.error).toBe('boom');
  });

  it('без adapter в opts берёт адаптер из настроек (getOneCAdapter)', async () => {
    const { prisma } = docsPrisma([]);
    const { adapter } = adapterWith({});
    getOneCAdapter.mockReturnValue(adapter);
    await reconcilePushedDocuments(prisma);
    expect(getOneCAdapter).toHaveBeenCalledTimes(1);
  });
});

type Lead = { id: string; pushedToOneCAt: Date };

function leadsPrisma(
  rows: Lead[],
  logRows: Array<{ operation: string; status: string; externalId?: string; cabinetLeadId?: string }>
) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const byPayload = where.payload as { equals: string } | undefined;
    const hit = logRows.find(
      (r) =>
        r.operation === where.operation &&
        r.status === where.status &&
        (byPayload ? r.cabinetLeadId === byPayload.equals : r.externalId === where.externalId)
    );
    return hit ? { id: 'log-1' } : null;
  });
  const prisma = {
    lead: { findMany, updateMany },
    syncLog: { findFirst },
  } as unknown as PrismaClient;
  return { prisma, findMany, updateMany, findFirst };
}

describe('reconcileStuckLeads', () => {
  const claimedAt = new Date(NOW.getTime() - 30 * HOURS);

  it('ищет претензии старше суток без externalIdInOneC', async () => {
    const { prisma, findMany } = leadsPrisma([], []);
    await reconcileStuckLeads(prisma, { now: NOW });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        pushedToOneCAt: { lt: new Date(NOW.getTime() - 24 * HOURS) },
        externalIdInOneC: null,
      },
      select: { id: true, pushedToOneCAt: true },
      orderBy: { pushedToOneCAt: 'asc' },
    });
  });

  it('лид, который 1С приняла без своего номера (success в истории), не трогается', async () => {
    const { prisma, updateMany, findFirst } = leadsPrisma(
      [{ id: 'lead-ok', pushedToOneCAt: claimedAt }],
      [{ operation: 'create', status: 'success', cabinetLeadId: 'lead-ok' }]
    );
    const res = await reconcileStuckLeads(prisma, { now: NOW });
    expect(res).toEqual({ requeued: [], stuck: [] });
    expect(updateMany).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
    expect(writeSyncLog).not.toHaveBeenCalled();
    // Ищем именно по cabinetLeadId в payload: externalId success-строки — номер 1С.
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      entity: 'lead',
      direction: 'outbound',
      operation: 'create',
      status: 'success',
      payload: { path: ['cabinetLeadId'], equals: 'lead-ok' },
    });
  });

  it('первый раз: претензия снимается, лид ставится в очередь, warn в истории', async () => {
    const { prisma, updateMany } = leadsPrisma([{ id: 'lead-1', pushedToOneCAt: claimedAt }], []);
    const res = await reconcileStuckLeads(prisma, { now: NOW });
    expect(res).toEqual({ requeued: ['lead-1'], stuck: [] });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', pushedToOneCAt: { not: null } },
      data: { pushedToOneCAt: null },
    });
    expect(getQueue).toHaveBeenCalledWith('oneCSync.pushLead');
    expect(queueAdd).toHaveBeenCalledWith(
      'push',
      { leadId: 'lead-1' },
      { jobId: expect.stringMatching(/^push-lead:lead-1:\d+$/) }
    );
    expect(writeSyncLog).toHaveBeenCalledWith(
      {
        entity: 'lead',
        direction: 'outbound',
        operation: 'check',
        status: 'warn',
        externalId: 'lead-1',
        payload: { cabinetLeadId: 'lead-1', reason: 'stuck_claim', claimedAt, action: 'requeued' },
      },
      prisma
    );
    // Порядок важен: сначала снять претензию, потом задача.
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      queueAdd.mock.invocationCallOrder[0]
    );
  });

  it('второй раз (warn за 48 часов уже есть): error в истории, лид не трогается', async () => {
    const { prisma, updateMany, findFirst } = leadsPrisma(
      [{ id: 'lead-2', pushedToOneCAt: claimedAt }],
      [{ operation: 'check', status: 'warn', externalId: 'lead-2' }]
    );
    const res = await reconcileStuckLeads(prisma, { now: NOW });
    expect(res).toEqual({ requeued: [], stuck: ['lead-2'] });
    expect(updateMany).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
    expect(writeSyncLog).toHaveBeenCalledWith(
      {
        entity: 'lead',
        direction: 'outbound',
        operation: 'check',
        status: 'error',
        externalId: 'lead-2',
        errorMessage: 'lead_stuck_in_push',
        payload: { cabinetLeadId: 'lead-2', reason: 'stuck_claim', claimedAt, action: 'gave_up' },
      },
      prisma
    );
    expect(findFirst.mock.calls[1][0].where).toMatchObject({
      operation: 'check',
      status: 'warn',
      externalId: 'lead-2',
      createdAt: { gte: new Date(NOW.getTime() - 48 * HOURS) },
    });
  });

  it('очередь недоступна: претензия уже снята, error в истории, лид в stuck', async () => {
    getQueue.mockImplementation(() => {
      throw new Error('REDIS_URL is not set');
    });
    const { prisma, updateMany } = leadsPrisma([{ id: 'lead-3', pushedToOneCAt: claimedAt }], []);
    const res = await reconcileStuckLeads(prisma, { now: NOW });
    expect(res).toEqual({ requeued: [], stuck: ['lead-3'] });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        externalId: 'lead-3',
        errorMessage: 'REDIS_URL is not set',
        payload: expect.objectContaining({ action: 'requeue_failed' }),
      }),
      prisma
    );
  });

  it('не-Error от очереди превращается в строку', async () => {
    queueAdd.mockRejectedValueOnce('redis down');
    const { prisma } = leadsPrisma([{ id: 'lead-4', pushedToOneCAt: claimedAt }], []);
    const res = await reconcileStuckLeads(prisma, { now: NOW });
    expect(res.stuck).toEqual(['lead-4']);
    expect(writeSyncLog.mock.calls[0][0]).toMatchObject({ errorMessage: 'redis down' });
  });

  it('now по умолчанию — текущее время', async () => {
    const { prisma, findMany } = leadsPrisma([], []);
    const before = Date.now();
    await reconcileStuckLeads(prisma);
    const lt = findMany.mock.calls[0][0].where.pushedToOneCAt.lt as Date;
    expect(lt.getTime()).toBeGreaterThanOrEqual(before - 24 * HOURS);
    expect(lt.getTime()).toBeLessThanOrEqual(Date.now() - 24 * HOURS);
  });
});
