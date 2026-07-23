import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';

/**
 * Диагностика вебхуков (этап 1 ТЗ, ФТ-14.4, спека §6): отметка «последнее
 * входящее событие» в SyncState (entity `webhook.<name>`).
 *
 * Never-throws по контракту: вебхук обязан вернуть 200 быстро (НФ-4 degrade
 * gracefully), поэтому сбой записи глотается с log.warn и не влияет на ответ.
 */

export type WebhookName = 'telegram' | 'max' | 'whatsapp' | 'mango';

export async function recordWebhookEvent(prisma: PrismaClient, name: WebhookName): Promise<void> {
  const entity = `webhook.${name}`;
  const now = new Date();
  try {
    await prisma.syncState.upsert({
      where: { entity },
      create: { entity, lastSuccessAt: now },
      update: { lastSuccessAt: now }
    });
  } catch (err) {
    log.warn('[webhookDiagnostics] record failed', {
      name,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
