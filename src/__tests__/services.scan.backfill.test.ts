import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: vi.fn() }),
  closeAllQueues: vi.fn(),
  QUEUE_NAMES: ['docs.scanDocument'],
}));

import { backfillTable, runBackfill } from '@/lib/services/scan/backfill';

function makeQueue() {
  const add = vi.fn().mockResolvedValue({});
  return { queue: { add } as { add: typeof add }, add };
}

describe('backfillTable', () => {
  it('returns 0 when fetch yields no rows', async () => {
    const { queue, add } = makeQueue();
    const fetchBatch = vi.fn().mockResolvedValue([]);
    const count = await backfillTable('document', fetchBatch, queue, 100);
    expect(count).toBe(0);
    expect(add).not.toHaveBeenCalled();
    expect(fetchBatch).toHaveBeenCalledTimes(1);
  });

  it('enqueues one job per row with kind+id payload', async () => {
    const { queue, add } = makeQueue();
    const fetchBatch = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      .mockResolvedValueOnce([]);
    const count = await backfillTable('document', fetchBatch, queue, 100);
    expect(count).toBe(3);
    expect(add).toHaveBeenCalledTimes(3);
    expect(add).toHaveBeenNthCalledWith(1, 'scan', { kind: 'document', id: 'a' });
    expect(add).toHaveBeenNthCalledWith(2, 'scan', { kind: 'document', id: 'b' });
    expect(add).toHaveBeenNthCalledWith(3, 'scan', { kind: 'document', id: 'c' });
  });

  it('walks multiple batches when fetch returns full pages', async () => {
    const { queue, add } = makeQueue();
    const fetchBatch = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
      .mockResolvedValueOnce([{ id: 'c' }, { id: 'd' }])
      .mockResolvedValueOnce([{ id: 'e' }])
      .mockResolvedValueOnce([]);
    const count = await backfillTable('document', fetchBatch, queue, 2);
    expect(count).toBe(5);
    expect(add).toHaveBeenCalledTimes(5);
    // First call with cursor=null, then each subsequent call with the last seen id.
    expect(fetchBatch.mock.calls[0]).toEqual([null, 2]);
    expect(fetchBatch.mock.calls[1]).toEqual(['b', 2]);
    expect(fetchBatch.mock.calls[2]).toEqual(['d', 2]);
  });

  it('stops fetching once a partial batch is returned', async () => {
    const { queue, add } = makeQueue();
    const fetchBatch = vi.fn().mockResolvedValueOnce([{ id: 'a' }]);
    const count = await backfillTable('leadAttachment', fetchBatch, queue, 10);
    expect(count).toBe(1);
    expect(add).toHaveBeenCalledWith('scan', { kind: 'leadAttachment', id: 'a' });
    // Partial page short-circuits — no second fetch.
    expect(fetchBatch).toHaveBeenCalledTimes(1);
  });
});

describe('runBackfill', () => {
  let documentFindMany: ReturnType<typeof vi.fn>;
  let leadFindMany: ReturnType<typeof vi.fn>;
  let inboundFindMany: ReturnType<typeof vi.fn>;
  let queueAdd: ReturnType<typeof vi.fn>;
  let db: Parameters<typeof runBackfill>[0];

  beforeEach(() => {
    documentFindMany = vi.fn();
    leadFindMany = vi.fn();
    inboundFindMany = vi.fn().mockResolvedValue([]);
    queueAdd = vi.fn().mockResolvedValue({});
    db = {
      document: { findMany: documentFindMany },
      leadAttachment: { findMany: leadFindMany },
      inboundMessage: { findMany: inboundFindMany },
    } as any;
  });

  it('enqueues across both tables, returning per-table counts', async () => {
    documentFindMany.mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }]).mockResolvedValueOnce([]);
    leadFindMany.mockResolvedValueOnce([{ id: 'l1' }]).mockResolvedValueOnce([]);

    const result = await runBackfill(db, { add: queueAdd }, 100);

    expect(result).toEqual({ enqueued: 3, documents: 2, leadAttachments: 1, inboundAttachments: 0 });
    expect(queueAdd).toHaveBeenCalledTimes(3);
    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'document', id: 'd1' });
    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'leadAttachment', id: 'l1' });
  });

  it('is idempotent: second invocation after WHERE clears finds nothing', async () => {
    // first pass — one pending row
    documentFindMany.mockResolvedValueOnce([{ id: 'd1' }]).mockResolvedValueOnce([]);
    leadFindMany.mockResolvedValueOnce([]);
    const first = await runBackfill(db, { add: queueAdd }, 100);
    expect(first.enqueued).toBe(1);

    // second pass — processor has flipped d1's status, queries return [].
    documentFindMany.mockResolvedValueOnce([]);
    leadFindMany.mockResolvedValueOnce([]);
    const second = await runBackfill(db, { add: queueAdd }, 100);
    expect(second).toEqual({ enqueued: 0, documents: 0, leadAttachments: 0, inboundAttachments: 0 });
  });

  it('passes the configured batch size into the findMany take param', async () => {
    documentFindMany.mockResolvedValueOnce([]);
    leadFindMany.mockResolvedValueOnce([]);
    await runBackfill(db, { add: queueAdd }, 50);
    expect(documentFindMany.mock.calls[0][0]).toMatchObject({ take: 50 });
    expect(leadFindMany.mock.calls[0][0]).toMatchObject({ take: 50 });
  });

  it('uses cursor + skip:1 for subsequent pages (cuid-stable ordering)', async () => {
    documentFindMany
      .mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }])
      .mockResolvedValueOnce([]);
    leadFindMany.mockResolvedValueOnce([]);
    await runBackfill(db, { add: queueAdd }, 2);
    // First page: no cursor.
    expect(documentFindMany.mock.calls[0][0]).not.toHaveProperty('cursor');
    // Second page: cursor=d2, skip:1.
    expect(documentFindMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: 'd2' },
      skip: 1,
    });
  });

  it('leadAttachment table also uses cursor on subsequent pages', async () => {
    documentFindMany.mockResolvedValueOnce([]);
    leadFindMany
      .mockResolvedValueOnce([{ id: 'l1' }, { id: 'l2' }])
      .mockResolvedValueOnce([]);
    await runBackfill(db, { add: queueAdd }, 2);
    // Second page of leadAttachments uses cursor from last row of first page
    expect(leadFindMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: 'l2' },
      skip: 1,
    });
  });

  it('uses BACKFILL_BATCH env variable when batchSize arg not provided', async () => {
    process.env.BACKFILL_BATCH = '42';
    documentFindMany.mockResolvedValueOnce([]);
    leadFindMany.mockResolvedValueOnce([]);
    // Call without batchSize arg to trigger the default parameter expression
    await runBackfill(db, { add: queueAdd });
    expect(documentFindMany.mock.calls[0][0]).toMatchObject({ take: 42 });
    delete process.env.BACKFILL_BATCH;
  });

  it('uses default 500 batch size when no BACKFILL_BATCH env and no batchSize arg', async () => {
    // Covers line 48: process.env.BACKFILL_BATCH ?? '500' — arm 0 (env IS undefined → use '500')
    // Ensure env is not set
    delete process.env.BACKFILL_BATCH;
    documentFindMany.mockResolvedValueOnce([]);
    leadFindMany.mockResolvedValueOnce([]);
    await runBackfill(db, { add: queueAdd });
    // Default batchSize = Number('500') = 500
    expect(documentFindMany.mock.calls[0][0]).toMatchObject({ take: 500 });
  });

  it('enqueues pending inbound-attachment rows with kind:inbound_attachment', async () => {
    documentFindMany.mockResolvedValueOnce([]);
    leadFindMany.mockResolvedValueOnce([]);
    inboundFindMany.mockReset();
    inboundFindMany.mockResolvedValueOnce([{ id: 'im1' }]).mockResolvedValueOnce([]);

    const result = await runBackfill(db, { add: queueAdd }, 100);

    expect(result).toEqual({ enqueued: 1, documents: 0, leadAttachments: 0, inboundAttachments: 1 });
    expect(queueAdd).toHaveBeenCalledWith('scan', { kind: 'inbound_attachment', id: 'im1' });
    expect(inboundFindMany.mock.calls[0][0]).toMatchObject({
      where: { scanStatus: 'pending', attachmentPath: { not: null } },
      take: 100,
    });
  });

  it('inboundMessage table also uses cursor on subsequent pages', async () => {
    documentFindMany.mockResolvedValueOnce([]);
    leadFindMany.mockResolvedValueOnce([]);
    inboundFindMany.mockReset();
    inboundFindMany
      .mockResolvedValueOnce([{ id: 'im1' }, { id: 'im2' }])
      .mockResolvedValueOnce([]);
    await runBackfill(db, { add: queueAdd }, 2);
    expect(inboundFindMany.mock.calls[0][0]).not.toHaveProperty('cursor');
    expect(inboundFindMany.mock.calls[1][0]).toMatchObject({
      cursor: { id: 'im2' },
      skip: 1,
    });
  });
});
