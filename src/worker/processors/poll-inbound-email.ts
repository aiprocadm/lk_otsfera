import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import { getInboundEmailAdapter } from '@/lib/inbound/email';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';
import { log } from '@/lib/logging';

export type PollInboundEmailResult = {
  processed: number;
  failed: number;
};

export async function pollInboundEmailProcessor(
  _job: Job,
  db: PrismaClient = prisma
): Promise<PollInboundEmailResult> {
  // IMAP-конфиг и выбор адаптера — из кэша настроек; праймим каждый прогон,
  // чтобы правки из /admin/integrations подхватывались без рестарта воркера.
  await primeIntegrationSettingsCache(db);

  const state = await db.syncState.findUnique({ where: { entity: 'inbound.email' } });
  const { messages, cursor } = await getInboundEmailAdapter().fetchNewMessages(
    state?.cursor ?? null
  );

  let failed = 0;
  for (const m of messages) {
    await ingestInboundMessage(db, {
      channel: 'email',
      externalId: `email:${m.externalId}`,
      senderRef: m.from.trim().toLowerCase(),
      // exactOptionalPropertyTypes: InboundDto различает «ключа нет» и «ключ = undefined».
      ...(m.subject !== undefined ? { subject: m.subject } : {}),
      body: m.text,
    }).catch((err) => {
      failed += 1;
      log.warn('[poll-inbound-email] ingest failed', {
        externalId: m.externalId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const now = new Date();
  if (failed === 0) {
    await db.syncState.upsert({
      where: { entity: 'inbound.email' },
      create: {
        entity: 'inbound.email',
        cursor,
        lastRunAt: now,
        lastSuccessAt: now,
        lastError: null,
      },
      update: { cursor, lastRunAt: now, lastSuccessAt: now, lastError: null },
    });
  } else {
    // Курсор НЕ продвигаем: иначе упавшее письмо потеряно навсегда. Следующий
    // поллинг перечитает батч со старого курсора — успешно принятые письма
    // дедупятся в ingest по externalId, упавшие получают повторную попытку.
    const lastError = `${failed}/${messages.length} ingest failed — cursor held for retry`;
    log.warn('[poll-inbound-email] cursor held', { failed, total: messages.length });
    await db.syncState.upsert({
      where: { entity: 'inbound.email' },
      create: { entity: 'inbound.email', cursor: state?.cursor ?? null, lastRunAt: now, lastError },
      update: { lastRunAt: now, lastError },
    });
  }

  return { processed: messages.length - failed, failed };
}
