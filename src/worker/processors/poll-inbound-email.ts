import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getInboundEmailAdapter } from '@/lib/inbound/email';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { log } from '@/lib/logging';

export type PollInboundEmailResult = {
  processed: number;
};

export async function pollInboundEmailProcessor(
  _job: Job,
  db: PrismaClient = prisma
): Promise<PollInboundEmailResult> {
  const state = await db.syncState.findUnique({ where: { entity: 'inbound.email' } });
  const { messages, cursor } = await getInboundEmailAdapter().fetchNewMessages(state?.cursor ?? null);

  for (const m of messages) {
    await ingestInboundMessage(db, {
      channel: 'email',
      externalId: `email:${m.externalId}`,
      senderRef: m.from.trim().toLowerCase(),
      subject: m.subject,
      body: m.text
    }).catch((err) => {
      log.warn('[poll-inbound-email] ingest failed', {
        externalId: m.externalId,
        error: err instanceof Error ? err.message : String(err)
      });
    });
  }

  const now = new Date();
  await db.syncState.upsert({
    where: { entity: 'inbound.email' },
    create: { entity: 'inbound.email', cursor, lastRunAt: now, lastSuccessAt: now },
    update: { cursor, lastRunAt: now, lastSuccessAt: now }
  });

  return { processed: messages.length };
}
