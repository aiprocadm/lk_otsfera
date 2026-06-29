import type { PrismaClient } from '@prisma/client';
import type { BatchSummary } from './record-batch';

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
