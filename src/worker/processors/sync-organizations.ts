import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { OneCOrgSchema } from '@/lib/services/oneCSync/schemas';
import type { OneCOrgDto } from '@/lib/services/oneCSync/dto';
import { mapOrgDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { getCursor, advanceCursor, markCursorError } from '@/lib/services/oneCSync/cursor';
import { runRecordBatch, batchStatus, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { oneCMode } from '@/lib/services/oneCSync/config';

export type SyncOrganizationsResult = BatchSummary;

async function resolvePartnerId(db: PrismaClient, partnerExternalId: string | null): Promise<string | null> {
  if (!partnerExternalId) return null;
  const partner = await db.partner.findUnique({ where: { slug: partnerExternalId }, select: { id: true } });
  return partner?.id ?? null;
}

export async function syncOrganizationsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncOrganizationsResult> {
  const startedAt = Date.now();
  const mode = oneCMode();
  console.log('[worker] sync-organizations job started', { id: job.id, mode });

  try {
    const adapter = getOneCAdapter();
    const cursor = await getCursor(db, 'organization');
    const raw = (await adapter.pullOrganizations(cursor)) as unknown[];

    let maxUpdatedAt: Date | null = null;
    const bump = (iso: string) => {
      const t = new Date(iso);
      if (!maxUpdatedAt || t > maxUpdatedAt) maxUpdatedAt = t;
    };

    const summary = await runRecordBatch<OneCOrgDto>(
      raw,
      OneCOrgSchema,
      (dto) => dto.externalId,
      async (dto, sum) => {
        const input = mapOrgDto(dto);
        const partnerId = await resolvePartnerId(db, input.partnerExternalId);
        if (!partnerId) {
          sum.skipped += 1;
          sum.skips.push({
            externalId: input.externalId,
            reason: input.partnerExternalId ? 'partner_not_found' : 'no_partner_external_id'
          });
          return;
        }
        const existing = await db.organization.findUnique({
          where: { externalId: input.externalId },
          select: { id: true, companyId: true }
        });

        if (existing) {
          if (mode === 'live') {
            await db.organization.update({
              where: { id: existing.id },
              data: { name: input.name, inn: input.inn, kpp: input.kpp }
            });
          }
          sum.updated += 1;
          bump(dto.updatedAt);
        } else {
          if (mode === 'live') {
            await db.$transaction(async (tx) => {
              const company = await tx.company.create({ data: { name: input.name } });
              await tx.organization.create({
                data: { externalId: input.externalId, name: input.name, inn: input.inn, kpp: input.kpp, partnerId, companyId: company.id }
              });
            });
          }
          sum.created += 1;
          bump(dto.updatedAt);
        }
      }
    );

    if (mode === 'live') await advanceCursor(db, 'organization', maxUpdatedAt);

    await writeSyncLog(
      {
        entity: 'organization',
        direction: 'inbound',
        operation: mode === 'shadow' ? 'check' : summary.created > 0 ? 'create' : 'update',
        status: batchStatus(summary),
        payload: { mode, ...summary },
        durationMs: Date.now() - startedAt
      },
      db
    );

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markCursorError(db, 'organization', message).catch((e) =>
      console.warn('[sync-organizations] markCursorError failed', e)
    );
    await writeSyncLog(
      { entity: 'organization', direction: 'inbound', operation: 'skip', status: 'error', errorMessage: message, durationMs: Date.now() - startedAt },
      db
    );
    throw err;
  }
}
