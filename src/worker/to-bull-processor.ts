import type { Job, Processor } from 'bullmq';

/**
 * Adapt an internal processor to BullMQ's call convention.
 *
 * BullMQ invokes a processor as `processor(job, token, signal)`. Our processors
 * use the second positional parameter as an injectable dependency seam
 * (`db: PrismaClient = prisma`, and sometimes a third `deps = ...`). Handing a
 * processor to `new Worker` directly lets BullMQ's `token` string clobber that
 * default, so the first `db.<model>` access throws
 * `Cannot read properties of undefined (reading 'findUnique')`.
 *
 * Forwarding only `job` keeps each processor's own defaults intact. No processor
 * uses `token`/`signal`; if one ever needs the abort signal, give it an explicit
 * wrapper rather than widening this one.
 */
export function toBullProcessor<T = unknown>(processor: Processor<T>): Processor<T> {
  return (job: Job<T>) => processor(job);
}
