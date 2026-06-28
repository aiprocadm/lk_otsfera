import { describe, it, expect } from 'vitest';
import type { Job } from 'bullmq';
import { toBullProcessor } from '@/worker/to-bull-processor';

/**
 * Regression guard for the worker wiring bug:
 *
 * BullMQ invokes a processor as `processor(job, token, signal)`. Our processors
 * declare an injectable second parameter `db: PrismaClient = prisma` (a test seam).
 * If the processor is handed to `new Worker` directly, BullMQ's `token` STRING is
 * bound to `db`, the default never applies, and the first `db.<model>` access throws
 * `Cannot read properties of undefined (reading 'findUnique')`.
 *
 * `toBullProcessor` must forward ONLY the job, so each processor's own defaults apply.
 */
describe('toBullProcessor', () => {
  const job = { id: '1', data: {} } as unknown as Job;

  it('forwards only the job — not BullMQ token/signal — to the processor', async () => {
    const received: unknown[][] = [];
    const processor = (...args: unknown[]) => {
      received.push(args);
      return Promise.resolve('ok');
    };

    const wrapped = toBullProcessor(processor as never);
    await wrapped(job, 'bull-token-string', new AbortController().signal);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([job]); // job only, no token/signal leaking in
  });

  it("lets a processor's injected default (e.g. db = prisma) survive BullMQ's token", async () => {
    const sentinelDefault = Symbol('default-db');
    let seenDb: unknown;
    const processor = (_job: Job, db: unknown = sentinelDefault) => {
      seenDb = db;
      return Promise.resolve('ok');
    };

    const wrapped = toBullProcessor(processor as never);
    await wrapped(job, 'bull-token-string', new AbortController().signal);

    expect(seenDb).toBe(sentinelDefault); // token did NOT clobber the injected default
  });

  it('propagates the processor result (BullMQ uses it for the completed event)', async () => {
    const wrapped = toBullProcessor((() => Promise.resolve({ ok: true })) as never);
    await expect(wrapped(job, 'tok', new AbortController().signal)).resolves.toEqual({ ok: true });
  });

  it('propagates rejection so BullMQ retries the job', async () => {
    const wrapped = toBullProcessor((() => Promise.reject(new Error('boom'))) as never);
    await expect(wrapped(job, 'tok', new AbortController().signal)).rejects.toThrow('boom');
  });
});
