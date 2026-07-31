import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runRecordBatch, batchStatus, emptySummary } from '@/lib/services/oneCSync/record-batch';

const schema = z.object({ externalId: z.string(), n: z.number() });

describe('runRecordBatch', () => {
  it('quarantines invalid records and runs the handler on valid ones', async () => {
    const handled: string[] = [];
    const summary = await runRecordBatch(
      [
        { externalId: 'a', n: 1 },
        { externalId: 'b', n: 'x' },
        { externalId: 'c', n: 3 },
      ],
      schema,
      (r) => r.externalId,
      async (r, sum) => {
        handled.push(r.externalId);
        sum.created += 1;
      }
    );
    expect(summary.pulled).toBe(3);
    expect(summary.invalid).toBe(1);
    expect(summary.invalids[0].externalId).toBe('b');
    expect(summary.created).toBe(2);
    expect(handled).toEqual(['a', 'c']);
  });

  it('isolates a throwing handler: one poison record does not abort the batch', async () => {
    const summary = await runRecordBatch(
      [
        { externalId: 'a', n: 1 },
        { externalId: 'poison', n: 2 },
        { externalId: 'c', n: 3 },
      ],
      schema,
      (r) => r.externalId,
      async (r, sum) => {
        if (r.externalId === 'poison') throw new Error('boom');
        sum.created += 1;
      }
    );
    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]).toEqual({ externalId: 'poison', error: 'boom' });
  });
});

describe('batchStatus', () => {
  it('is success only when nothing was skipped/invalid/failed', () => {
    const s = emptySummary();
    expect(batchStatus(s)).toBe('success');
    s.invalid = 1;
    expect(batchStatus(s)).toBe('warn');
  });
  it('is warn when there are skipped records', () => {
    const s = emptySummary();
    s.skipped = 1;
    expect(batchStatus(s)).toBe('warn');
  });
  it('is warn when there are failed records', () => {
    const s = emptySummary();
    s.failed = 1;
    expect(batchStatus(s)).toBe('warn');
  });
});

describe('runRecordBatch — non-Error throw', () => {
  const schema = z.object({ externalId: z.string(), n: z.number() });

  it('stores string representation of non-Error throws in failures', async () => {
    const summary = await runRecordBatch(
      [{ externalId: 'x', n: 1 }],
      schema,
      (r) => r.externalId,
      async () => {
        throw 'plain string throw';
      }
    );
    expect(summary.failed).toBe(1);
    expect(summary.failures[0].error).toBe('plain string throw');
  });
});
