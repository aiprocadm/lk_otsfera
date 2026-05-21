import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SyncJobPayload } from '@/lib/jobs/types';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { mapOrgDto } from '@/lib/services/oneCSync/mappers';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

export type SyncOrganizationsResult = {
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
};

type SkipReason = 'partner_not_found' | 'no_partner_external_id';

async function resolvePartnerId(
  db: PrismaClient,
  partnerExternalId: string | null
): Promise<string | null> {
  if (!partnerExternalId) return null;
  const partner = await db.partner.findUnique({
    where: { slug: partnerExternalId },
    select: { id: true }
  });
  return partner?.id ?? null;
}

export async function syncOrganizationsProcessor(
  job: Job<SyncJobPayload>,
  db: PrismaClient = prisma
): Promise<SyncOrganizationsResult> {
  const startedAt = Date.now();
  console.log('[worker] sync-organizations job started', { id: job.id });

  const summary: SyncOrganizationsResult = {
    pulled: 0,
    created: 0,
    updated: 0,
    skipped: 0
  };
  const skips: Array<{ externalId: string; reason: SkipReason }> = [];

  try {
    const adapter = getOneCAdapter();
    const dtos = await adapter.pullOrganizations({});
    summary.pulled = dtos.length;

    for (const dto of dtos) {
      const input = mapOrgDto(dto);
      const partnerId = await resolvePartnerId(db, input.partnerExternalId);

      if (!partnerId) {
        summary.skipped += 1;
        skips.push({
          externalId: input.externalId,
          reason: input.partnerExternalId ? 'partner_not_found' : 'no_partner_external_id'
        });
        continue;
      }

      const existing = await db.organization.findUnique({
        where: { externalId: input.externalId },
        select: { id: true, companyId: true }
      });

      if (existing) {
        await db.organization.update({
          where: { id: existing.id },
          data: {
            name: input.name,
            inn: input.inn,
            kpp: input.kpp
          }
        });
        summary.updated += 1;
      } else {
        const company = await db.company.create({ data: { name: input.name } });
        await db.organization.create({
          data: {
            externalId: input.externalId,
            name: input.name,
            inn: input.inn,
            kpp: input.kpp,
            partnerId,
            companyId: company.id
          }
        });
        summary.created += 1;
      }
    }

    await writeSyncLog({
      entity: 'organization',
      direction: 'inbound',
      operation: summary.created > 0 ? 'create' : 'update',
      status: skips.length > 0 ? 'warn' : 'success',
      payload: { ...summary, skips },
      durationMs: Date.now() - startedAt
    });

    return summary;
  } catch (err) {
    await writeSyncLog({
      entity: 'organization',
      direction: 'inbound',
      operation: 'skip',
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      payload: summary,
      durationMs: Date.now() - startedAt
    });
    throw err;
  }
}
