import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import type { PushLeadJobPayload } from '@/lib/jobs/types';
import { pushLeadToOneC } from '@/lib/services/oneCSync/push';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { log } from '@/lib/logging';

export type PushLeadProcessorResult = {
  leadId: string;
  externalIdInOneC: string | null;
};

export async function pushLeadProcessor(
  job: Job<PushLeadJobPayload>,
  db: PrismaClient = prisma
): Promise<PushLeadProcessorResult> {
  log.info('[worker] push-lead job started', { id: job.id, leadId: job.data.leadId });

  // Конфиг адаптера 1С — в настройках интеграций; праймим кэш перед пушем,
  // чтобы новые креды из /admin/integrations доехали до воркера без рестарта.
  await primeIntegrationSettingsCache(db);
  const res = await pushLeadToOneC(db, job.data.leadId);
  if (!res.ok) {
    throw new Error(res.error);
  }

  return { leadId: job.data.leadId, externalIdInOneC: res.externalIdInOneC };
}

export async function notifyPushLeadFinalFailure(
  db: PrismaClient,
  args: { leadId: string; errorMessage: string }
): Promise<void> {
  const lead = await db.lead.findUnique({
    where: { id: args.leadId },
    select: { partnerId: true, clientCompanyName: true },
  });
  // Этап 5: лид без партнёра — уведомлять некого.
  if (!lead || !lead.partnerId) return;

  const admins = await db.partnerUser.findMany({
    where: { partnerId: lead.partnerId, roleInPartner: 'admin', isActive: true },
    select: { userId: true },
  });

  if (admins.length === 0) return;

  await db.$transaction(
    admins.map((a) =>
      db.notification.create({
        data: {
          userId: a.userId,
          partnerId: lead.partnerId,
          type: 'sync_error',
          title: 'Не удалось отправить заявку в 1С',
          body: `Заявка ${lead.clientCompanyName} (${args.leadId}) не была принята: ${args.errorMessage}`,
          meta: {
            kind: 'push_lead_failed',
            leadId: args.leadId,
            error: args.errorMessage,
          },
        },
      })
    )
  );
}
