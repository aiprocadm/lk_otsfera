import type { Prisma, PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import { documentTypeLabelRu } from '@/lib/documents/fileName';
import { errorMessageRu } from '@/lib/errors/messages';
import { pluralizeRu } from '@/lib/format';
import type { PushDocumentJobPayload } from '@/lib/jobs/types';
import { pushDocumentToOneC, type PushDocumentRefusal } from '@/lib/services/oneCSync/pushDocument';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { log } from '@/lib/logging';

export type PushDocumentProcessorResult = {
  documentId: string;
  outcome: 'pushed' | 'same_version' | PushDocumentRefusal;
};

/**
 * Отказы, после которых документ стоит в `failed` и ждёт человека прямо
 * сейчас — очередь их не повторит, значит и уведомлять надо сразу (`У-174`).
 * Остальные отказы документ не трогают: КП и заменённая версия просто не
 * выгружаются, «не найден» — некого извещать.
 */
const NOTIFY_ON_REFUSAL: ReadonlySet<PushDocumentRefusal> = new Set([
  'counterparty_without_inn',
  'no_number',
]);

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
    if (NOTIFY_ON_REFUSAL.has(res.error)) {
      await notifyPushDocumentFinalFailure(db, {
        documentId,
        errorMessage: errorMessageRu(res.error),
        actorUserId,
      }).catch((e) => log.error('[worker] notifyPushDocumentFinalFailure failed', e));
    }
    return { documentId, outcome: res.error };
  }
  return { documentId, outcome: res.skipped ?? 'pushed' };
}

/**
 * `У-174`: слушатель `failed` очереди. Уведомление уходит один раз — после
 * ПОСЛЕДНЕЙ попытки: промежуточные сбои очередь повторит сама, и пять писем
 * об одном счёте научили бы людей их не читать. Вынесено из `worker/index.ts`,
 * чтобы условие «последняя ли попытка» было под тестом.
 */
export async function handlePushDocumentJobFailed(
  db: PrismaClient,
  job: Job<PushDocumentJobPayload> | undefined,
  err: Error
): Promise<void> {
  if (!job) return;
  if ((job.attemptsMade ?? 0) < (job.opts?.attempts ?? 1)) return;
  await notifyPushDocumentFinalFailure(db, {
    documentId: job.data.documentId,
    errorMessage: err.message,
    actorUserId: job.data.actorUserId,
  }).catch((e) => log.error('[worker] notifyPushDocumentFinalFailure failed', e));
}

/** Карточка документа в кабинете получателя — у каждой роли своя (`Р-23`). */
function documentUrlFor(role: string, documentId: string): string {
  const cabinet = role === 'admin' ? 'admin' : role === 'leader' ? 'leader' : 'manager';
  return `/${cabinet}/documents/${documentId}`;
}

/**
 * Кому: руководителям компании документа — они отвечают за обмен с 1С — и
 * тому, кто нажал «Выгрузить», если это другой человек: он ждёт результата.
 * Документ без компании (legacy) — только инициатору.
 */
export async function notifyPushDocumentFinalFailure(
  db: PrismaClient,
  args: { documentId: string; errorMessage: string; actorUserId?: string | undefined }
): Promise<void> {
  const doc = await db.document.findUnique({
    where: { id: args.documentId },
    select: { type: true, number: true, companyId: true, oneCPushAttempts: true },
  });
  if (!doc) return;

  const who: Prisma.UserWhereInput[] = [];
  if (doc.companyId) who.push({ role: 'leader', companyId: doc.companyId });
  if (args.actorUserId) who.push({ id: args.actorUserId });
  if (who.length === 0) return;
  const recipients = await db.user.findMany({
    where: { isActive: true, OR: who },
    select: { id: true, role: true },
  });
  if (recipients.length === 0) return;

  const name = `${documentTypeLabelRu(doc.type)} ${doc.number ?? 'без номера'}`;
  const n = doc.oneCPushAttempts;
  const attempts = n > 0 ? ` после ${n} ${pluralizeRu(n, 'попытки', 'попыток', 'попыток')}` : '';
  await db.$transaction(
    recipients.map((u) =>
      db.notification.create({
        data: {
          userId: u.id,
          type: 'sync_error',
          title: 'Не удалось выгрузить документ в 1С',
          body: `${name} не принят 1С${attempts}: ${args.errorMessage}. Откройте документ и нажмите «Повторить» или исправьте его.`,
          meta: {
            kind: 'push_document_failed',
            documentId: args.documentId,
            error: args.errorMessage,
            url: documentUrlFor(u.role, args.documentId),
          },
        },
      })
    )
  );
}
