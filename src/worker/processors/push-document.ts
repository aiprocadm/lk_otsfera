import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import type { PushDocumentJobPayload } from '@/lib/jobs/types';
import {
  pushDocumentToOneC,
  type PushDocumentRefusal,
} from '@/lib/services/oneCSync/pushDocument';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { log } from '@/lib/logging';

export type PushDocumentProcessorResult = {
  documentId: string;
  outcome: 'pushed' | 'same_version' | PushDocumentRefusal;
};

/**
 * Этап 8 (`У-168`): процессор очереди `oneCSync.pushDocument`.
 *
 * Исключение наружу — только на сбое адаптера: его BullMQ повторит (attempts 5,
 * §7). Окончательный отказ (КП, нет ИНН, нет номера, заменённая версия)
 * завершает задачу без исключения — повтор через секунду спросил бы то же
 * самое пять раз, а документ уже помечен `failed` с текстом для человека.
 */
export async function pushDocumentProcessor(
  job: Job<PushDocumentJobPayload>,
  db: PrismaClient = prisma
): Promise<PushDocumentProcessorResult> {
  const { documentId, actorUserId } = job.data;
  log.info('[worker] push-document job started', { id: job.id, documentId });

  // Конфиг адаптера 1С — в настройках интеграций; праймим кэш перед выгрузкой,
  // чтобы новые креды из /admin/integrations доехали до воркера без рестарта.
  await primeIntegrationSettingsCache(db);
  const res = await pushDocumentToOneC(db, documentId, { actorUserId });
  if (!res.ok) {
    if (res.error === 'push_failed') throw new Error(res.message);
    log.warn('[worker] push-document refused', { id: job.id, documentId, error: res.error });
    return { documentId, outcome: res.error };
  }
  return { documentId, outcome: res.skipped ?? 'pushed' };
}
