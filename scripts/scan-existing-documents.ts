/**
 * CLI: enqueue a docs.scanDocument job for every row stuck in
 * scanStatus='pending'. Safe to re-run — the processor flips rows
 * after scanning, so the WHERE clause filters them out next time.
 *
 *   npx tsx scripts/scan-existing-documents.ts
 *
 * Env:
 *   BACKFILL_BATCH (default 500) — rows fetched per page.
 *   REDIS_URL, DATABASE_URL — required (delegated to existing helpers).
 */

import { prisma } from '../src/lib/db/prisma';
import { closeAllQueues } from '../src/lib/jobs/queues';
import { closeRedisConnection } from '../src/lib/jobs/connection';
import { runBackfill } from '../src/lib/services/scan/backfill';

async function main() {
  console.log('[backfill] starting scan backfill (scanStatus=pending)');
  const result = await runBackfill();
  console.log('[backfill] done', result);
}

main()
  .catch((err) => {
    console.error('[backfill] error', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    await closeAllQueues().catch(() => undefined);
    await closeRedisConnection().catch(() => undefined);
    // BullMQ keeps Redis sockets alive; force-exit so the CLI doesn't hang.
    process.exit(process.exitCode ?? 0);
  });
