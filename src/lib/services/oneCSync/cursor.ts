import type { PrismaClient } from '@prisma/client';
import type { SyncCursor } from './dto';
import { oneCCursorOverlapMinutes } from './config';

export type CursorEntity = 'organization' | 'order' | 'payment' | 'document';

/** High-water mark minus a safety overlap (clock-skew / boundary protection). */
export function applyOverlap(maxUpdatedAt: Date, overlapMinutes: number): string {
  return new Date(maxUpdatedAt.getTime() - overlapMinutes * 60_000).toISOString();
}

export async function getCursor(db: PrismaClient, entity: CursorEntity): Promise<SyncCursor> {
  const row = await db.syncState.findUnique({ where: { entity }, select: { cursor: true } });
  return row?.cursor ? { since: row.cursor } : {};
}

/** Advance only when there was a successful high-water mark. null = no records handled → leave cursor. */
export async function advanceCursor(db: PrismaClient, entity: CursorEntity, maxUpdatedAt: Date | null): Promise<void> {
  const now = new Date();
  const base = { lastRunAt: now, lastSuccessAt: now, lastError: null as string | null };
  const cursor = maxUpdatedAt ? applyOverlap(maxUpdatedAt, oneCCursorOverlapMinutes()) : undefined;
  await db.syncState.upsert({
    where: { entity },
    create: { entity, ...base, ...(cursor ? { cursor } : {}) },
    update: { ...base, ...(cursor ? { cursor } : {}) }
  });
}

export async function markCursorError(db: PrismaClient, entity: CursorEntity, error: string): Promise<void> {
  const now = new Date();
  const msg = error.slice(0, 1000);
  await db.syncState.upsert({
    where: { entity },
    create: { entity, lastRunAt: now, lastError: msg },
    update: { lastRunAt: now, lastError: msg }
  });
}
