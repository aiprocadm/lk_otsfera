import type { PrismaClient } from '@prisma/client';
import type { MangoEvent } from '@/lib/telephony/mango/parse';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { resolveCaller } from './resolveCaller';

export type IngestCallResult = { ok: true; id: string; needsRecording?: boolean } | { ok: false; error: 'storage' };

/**
 * Idempotent ingest for Mango webhook events into the Call journal.
 * Keyed on the composite unique `provider_externalId`; Prisma's `upsert` is
 * atomic so repeated/concurrent identical events never create duplicate rows
 * (no separate findUnique-then-create race window, unlike inbound/ingest.ts
 * which needs the two-step form because InboundMessage's unique is a single
 * scalar with extra post-create side effects gating the race-catch).
 *
 * A call's lifecycle can deliver events out of order across separate
 * webhooks (`call` → `recording` → `summary`, or `call` → `summary`). Each
 * event kind upserts only the fields it carries; `summary` is authoritative
 * for `direction`/`durationSec`/`status` and always wins on merge because it
 * is the final, complete record Mango sends once the call has ended.
 */
export async function ingestCallEvent(prisma: PrismaClient, event: MangoEvent): Promise<IngestCallResult> {
  const where = { provider_externalId: { provider: 'mango', externalId: event.externalId } } as const;

  if (event.kind === 'summary') {
    const resolved = await resolveCaller(prisma, event.callerNumber);
    const resolvedFields =
      resolved.matchType === 'exact'
        ? {
            resolvedOrgId: resolved.orgId,
            resolvedUserId: resolved.userId ?? null,
            contactId: resolved.contactId ?? null,
            companyId: resolved.companyId,
          }
        : {};

    const existing = await prisma.call.findUnique({ where, select: { id: true } });
    const row = await prisma.call.upsert({
      where,
      create: {
        provider: 'mango',
        externalId: event.externalId,
        direction: event.direction,
        callerNumber: event.callerNumber,
        internalNumber: event.internalNumber ?? null,
        durationSec: event.durationSec ?? null,
        status: event.status ?? 'completed',
        finishedAt: new Date(),
        ...resolvedFields,
      },
      update: {
        direction: event.direction,
        callerNumber: event.callerNumber,
        internalNumber: event.internalNumber ?? null,
        durationSec: event.durationSec ?? null,
        status: event.status ?? 'completed',
        // finishedAt is set once on CREATE (the moment we first learn the call
        // ended); deliberately not re-stamped here so idempotent summary
        // replays don't mutate the row's timestamp.
        ...resolvedFields,
      },
      select: { id: true },
    });

    await writeSyncLog(
      {
        entity: 'call',
        externalId: event.externalId,
        direction: 'inbound',
        operation: existing ? 'update' : 'create',
        status: resolved.matchType === 'exact' ? 'success' : 'warn',
        errorMessage: resolved.matchType === 'exact' ? undefined : 'unresolved',
      },
      prisma
    );

    return { ok: true, id: row.id };
  }

  if (event.kind === 'call') {
    const resolved = event.callerNumber ? await resolveCaller(prisma, event.callerNumber) : { matchType: 'unresolved' as const };
    const resolvedFields =
      resolved.matchType === 'exact'
        ? {
            resolvedOrgId: resolved.orgId,
            resolvedUserId: resolved.userId ?? null,
            contactId: resolved.contactId ?? null,
            companyId: resolved.companyId,
          }
        : {};

    const existing = await prisma.call.findUnique({ where, select: { id: true } });
    const row = await prisma.call.upsert({
      where,
      create: {
        provider: 'mango',
        externalId: event.externalId,
        // NOT-NULL columns need sensible defaults on a call-first event; a
        // later summary event is the authoritative source and corrects these.
        direction: event.direction ?? 'inbound',
        callerNumber: event.callerNumber ?? '',
        status: event.status ?? 'in_progress',
        internalNumber: event.internalNumber ?? null,
        ...resolvedFields,
      },
      // 'call' is a preliminary/in-progress event. If the Call row already
      // exists, the authoritative 'summary' (whether it arrived earlier or
      // will arrive later) owns the mutable fields — do NOT clobber. A
      // call-first arrival is captured entirely by the CREATE branch; a call
      // arriving after a summary (network reorder / retry) is a no-op.
      update: {},
      select: { id: true },
    });

    await writeSyncLog(
      {
        entity: 'call',
        externalId: event.externalId,
        direction: 'inbound',
        operation: existing ? 'update' : 'create',
        status: resolved.matchType === 'exact' ? 'success' : 'warn',
        errorMessage: resolved.matchType === 'exact' ? undefined : 'unresolved',
      },
      prisma
    );

    return { ok: true, id: row.id };
  }

  // event.kind === 'recording'
  const existing = await prisma.call.findUnique({ where, select: { id: true } });
  const row = await prisma.call.upsert({
    where,
    create: {
      provider: 'mango',
      externalId: event.externalId,
      direction: 'inbound',
      callerNumber: '',
      status: 'completed',
      recordingId: event.recordingId,
    },
    update: {
      recordingId: event.recordingId,
    },
    select: { id: true },
  });

  await writeSyncLog(
    {
      entity: 'call',
      externalId: event.externalId,
      direction: 'inbound',
      operation: existing ? 'update' : 'create',
      status: 'success',
    },
    prisma
  );

  // The recording fetch itself is a separate, deliberately deferred step
  // (Task 6 enqueues docs.scanDocument-style download); this service only
  // signals that a recording is now available to fetch.
  return { ok: true, id: row.id, needsRecording: true };
}
