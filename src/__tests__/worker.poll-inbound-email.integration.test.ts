import { describe, expect, it, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';

const { fetchNewMessages, ingestInboundMessage } = vi.hoisted(() => ({
  fetchNewMessages: vi.fn(),
  ingestInboundMessage: vi.fn()
}));

vi.mock('@/lib/inbound/email', () => ({
  getInboundEmailAdapter: () => ({ fetchNewMessages })
}));
vi.mock('@/lib/services/inbound/ingest', () => ({ ingestInboundMessage }));

import { pollInboundEmailProcessor } from '@/worker/processors/poll-inbound-email';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.syncState.deleteMany({ where: { entity: 'inbound.email' } });
});

afterEach(async () => {
  vi.clearAllMocks();
  await prisma.syncState.deleteMany({ where: { entity: 'inbound.email' } });
});

afterAll(async () => {
  await prisma.syncState.deleteMany({ where: { entity: 'inbound.email' } }).catch(() => {});
  await prisma.$disconnect();
});

const job = {} as Job;

describe('pollInboundEmailProcessor', () => {
  it('ingests each fetched message and advances the SyncState cursor', async () => {
    fetchNewMessages.mockResolvedValue({
      messages: [{ externalId: 'abc123', from: 'Sender@Example.com', subject: 'Hello', text: 'body text' }],
      cursor: '1'
    });
    ingestInboundMessage.mockResolvedValue({ ok: true, id: 'im1', deduped: false });

    const result = await pollInboundEmailProcessor(job, prisma);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(ingestInboundMessage).toHaveBeenCalledTimes(1);
    expect(ingestInboundMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: 'email',
        externalId: 'email:abc123',
        senderRef: 'sender@example.com',
        subject: 'Hello',
        body: 'body text'
      })
    );

    const state = await prisma.syncState.findUnique({ where: { entity: 'inbound.email' } });
    expect(state).not.toBeNull();
    expect(state?.cursor).toBe('1');
    expect(state?.lastRunAt).not.toBeNull();
    expect(state?.lastSuccessAt).not.toBeNull();
    expect(state?.lastError).toBeNull();
  });

  it('passes the persisted cursor from a prior run into fetchNewMessages', async () => {
    await prisma.syncState.create({
      data: { entity: 'inbound.email', cursor: '5', lastRunAt: new Date(), lastSuccessAt: new Date() }
    });
    fetchNewMessages.mockResolvedValue({ messages: [], cursor: '5' });

    await pollInboundEmailProcessor(job, prisma);

    expect(fetchNewMessages).toHaveBeenCalledWith('5');
  });

  it('failing ingest does not abort the batch, but holds the cursor for a retry', async () => {
    await prisma.syncState.create({
      data: { entity: 'inbound.email', cursor: '1', lastRunAt: new Date(), lastSuccessAt: new Date() }
    });
    fetchNewMessages.mockResolvedValue({
      messages: [
        { externalId: 'ok1', from: 'a@example.com', text: 'body1' },
        { externalId: 'bad1', from: 'b@example.com', text: 'body2' }
      ],
      cursor: '2'
    });
    ingestInboundMessage
      .mockResolvedValueOnce({ ok: true, id: 'im1', deduped: false })
      .mockRejectedValueOnce(new Error('boom'));

    const result = await pollInboundEmailProcessor(job, prisma);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    // Курсор остался на '1': следующий поллинг перечитает батч, ok1 дедупится
    // по externalId, bad1 получает повторную попытку вместо тихой потери.
    const state = await prisma.syncState.findUnique({ where: { entity: 'inbound.email' } });
    expect(state?.cursor).toBe('1');
    expect(state?.lastError).toBe('1/2 ingest failed — cursor held for retry');
  });

  it('first-run failure creates SyncState without advancing past the null cursor', async () => {
    fetchNewMessages.mockResolvedValue({
      messages: [{ externalId: 'bad3', from: 'd@example.com', text: 'body' }],
      cursor: '7'
    });
    ingestInboundMessage.mockRejectedValueOnce(new Error('boom'));

    const result = await pollInboundEmailProcessor(job, prisma);

    expect(result.failed).toBe(1);
    const state = await prisma.syncState.findUnique({ where: { entity: 'inbound.email' } });
    expect(state).not.toBeNull();
    expect(state?.cursor).toBeNull();
    expect(state?.lastSuccessAt).toBeNull();
    expect(state?.lastError).toBe('1/1 ingest failed — cursor held for retry');
  });

  it('non-Error ingest rejection is stringified in the warn log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchNewMessages.mockResolvedValue({
      messages: [{ externalId: 'bad2', from: 'c@example.com', text: 'body' }],
      cursor: '3'
    });
    ingestInboundMessage.mockRejectedValueOnce('smtp gone');

    const result = await pollInboundEmailProcessor(job, prisma);

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      '[poll-inbound-email] ingest failed',
      expect.objectContaining({ externalId: 'bad2', error: 'smtp gone' })
    );
    expect(warn).toHaveBeenCalledWith(
      '[poll-inbound-email] cursor held',
      expect.objectContaining({ failed: 1, total: 1 })
    );
    warn.mockRestore();
  });
});
