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
  });

  it('passes the persisted cursor from a prior run into fetchNewMessages', async () => {
    await prisma.syncState.create({
      data: { entity: 'inbound.email', cursor: '5', lastRunAt: new Date(), lastSuccessAt: new Date() }
    });
    fetchNewMessages.mockResolvedValue({ messages: [], cursor: '5' });

    await pollInboundEmailProcessor(job, prisma);

    expect(fetchNewMessages).toHaveBeenCalledWith('5');
  });

  it('does not let a failing ingest call abort the batch or the cursor update', async () => {
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

    expect(result.processed).toBe(2);
    const state = await prisma.syncState.findUnique({ where: { entity: 'inbound.email' } });
    expect(state?.cursor).toBe('2');
  });
});
