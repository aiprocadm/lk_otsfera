import type { PrismaClient } from '@prisma/client';
import { type BatchSummary, emptySummary } from './record-batch';
import { OneCOrgSchema, OneCOrderSchema, OneCPaymentSchema, OneCDocumentSchema } from './schemas';
import { upsertOrgRecord, upsertOrderRecord, upsertPaymentRecord, upsertDocumentRecord, type WriteCtx } from './writers';
import { oneCPendingMaxAttempts, oneCPendingMaxAgeDays } from './config';

/** Skip reasons whose dependency may appear on a later sync, so the record is worth replaying. */
const TRANSIENT_REASONS = new Set(['organization_not_found', 'order_not_found', 'document_fetch_failed']);

/** True only for known dependency-ordering skips. Unknown/permanent reasons fail closed (no retry). */
export function isTransientSkip(reason: string): boolean {
  return TRANSIENT_REASONS.has(reason);
}

export type CursorEntity = 'organization' | 'order' | 'payment' | 'document';

/**
 * Persist transiently-skipped records so they can be replayed once their dependency
 * (org/order) appears. Stores the raw DTO verbatim; matched to a skip by externalId.
 */
export async function capturePendingSkips<T>(
  db: PrismaClient,
  entity: CursorEntity,
  raw: T[],
  getExternalId: (r: T) => string,
  summary: BatchSummary
): Promise<void> {
  const transient = summary.skips.filter((s) => isTransientSkip(s.reason));
  if (transient.length === 0) return;
  const byExt = new Map(raw.map((r) => [getExternalId(r), r]));
  for (const skip of transient) {
    const dto = byExt.get(skip.externalId);
    if (dto === undefined) continue; // defensive: skip referenced a record not in this batch
    await db.oneCPendingRecord.upsert({
      where: { entity_externalId: { entity, externalId: skip.externalId } },
      create: { entity, externalId: skip.externalId, dto: dto as object, reason: skip.reason },
      update: { reason: skip.reason, status: 'pending' },
    });
  }
}

type ReplayResult = { resolved: number; deadLettered: number; stillPending: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWriter = (db: PrismaClient, dto: any, sum: BatchSummary, ctx: WriteCtx) => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = { safeParse: (data: unknown) => { success: boolean; data?: any } };

const MS_PER_DAY = 86_400_000;

export async function replayPendingRecords(
  db: PrismaClient,
  entity: CursorEntity,
  opts: { now: Date; maxAttempts?: number; maxAgeDays?: number }
): Promise<ReplayResult> {
  const maxAttempts = opts.maxAttempts ?? oneCPendingMaxAttempts();
  const maxAgeDays = opts.maxAgeDays ?? oneCPendingMaxAgeDays();

  // entity → (zod schema, idempotent writer). Replaying the stored DTO is equivalent to
  // re-pulling it, but works with the bulk-only adapter (no fetch-by-externalId).
  let schema: AnySchema;
  let write: AnyWriter;
  switch (entity) {
    case 'organization': schema = OneCOrgSchema;    write = upsertOrgRecord;     break;
    case 'order':        schema = OneCOrderSchema;  write = upsertOrderRecord;   break;
    case 'payment':      schema = OneCPaymentSchema; write = upsertPaymentRecord; break;
    case 'document':     schema = OneCDocumentSchema; write = upsertDocumentRecord; break;
  }

  const rows = await db.oneCPendingRecord.findMany({
    where: { entity, status: 'pending' },
    orderBy: { firstSeenAt: 'asc' },
    take: 500,
  });

  let resolved = 0, deadLettered = 0, stillPending = 0;
  for (const row of rows) {
    const parsed = schema.safeParse(row.dto);
    const attempts = row.attempts + 1;
    const ageMs = opts.now.getTime() - new Date(row.firstSeenAt).getTime();
    const overAge = ageMs >= maxAgeDays * MS_PER_DAY;

    if (!parsed.success) {
      await db.oneCPendingRecord.update({ where: { id: row.id }, data: { attempts, status: 'dead', reason: 'invalid_stored_dto' } });
      deadLettered++; continue;
    }

    const summary = emptySummary();
    let reason = row.reason;
    try {
      await write(db, parsed.data, summary, { mode: 'live' as const, notify: true });
    } catch (err) {
      reason = err instanceof Error ? err.message.slice(0, 200) : 'replay_threw';
    }

    if (summary.created + summary.updated > 0) {
      await db.oneCPendingRecord.delete({ where: { id: row.id } });
      resolved++; continue;
    }

    const lastSkip = summary.skips.at(-1);
    if (lastSkip) reason = lastSkip.reason;
    const permanent = lastSkip ? !isTransientSkip(lastSkip.reason) : true;
    const dead = permanent || attempts >= maxAttempts || overAge;
    await db.oneCPendingRecord.update({
      where: { id: row.id },
      data: dead ? { attempts, status: 'dead', reason } : { attempts, reason },
    });
    if (dead) deadLettered++; else stillPending++;
  }
  return { resolved, deadLettered, stillPending };
}
