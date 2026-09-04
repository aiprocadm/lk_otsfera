import type { PrismaClient } from '@prisma/client';
import { getOneCAdapter, type OneCAdapter } from '.';
import { reissueChainRootId } from './pushDocument';
import { writeSyncLog } from './log';
import { errorMessageRu } from '@/lib/errors/messages';
import { getQueue } from '@/lib/jobs/queues';
import type { PushLeadJobPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';

/**
 * Этап 8 (`У-172`, `Д-26`): сверка того, что кабинет ОТПРАВИЛ в 1С, с тем,
 * что в 1С реально есть. Прежний «термометр» (`sync-reconcile.ts`) отвечает
 * на вопрос «обмен вообще живой?»; здесь — два других вопроса: «все ли
 * выгруженные документы на месте?» и «не завис ли лид в отправке?».
 */

/** Код причины в `SyncLog.errorMessage`; русский текст — `errorMessageRu`. */
const MISSING_IN_1C = 'missing_in_1c';
const LEAD_STUCK = 'lead_stuck_in_push';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Сколько помним, что лид уже переотправляли: второй раз за это окно — ошибка. */
const LEAD_RETRY_MEMORY_MS = 2 * DAY_MS;

export type ReconcileDocumentsResult = {
  /** Сколько документов 1С подтвердила или отвергла. */
  checked: number;
  /** Кого 1С не нашла — переведены в `failed`. */
  missing: string[];
  /** Сколько не успели спросить из-за ошибки транспорта. */
  unchecked: number;
  /** Текст ошибки транспорта, на которой сверка остановилась. */
  error: string | null;
};

/**
 * Документы в `pushed` (действующие версии) спрашиваются у 1С по одному —
 * по тому же id, под которым ушли (корень цепочки перевыпусков). «Нет
 * такого» → `failed` с русской причиной на карточке и `error` в истории
 * обмена; PR-10 (`У-174`) считает такие `failed` в светофоре и алерте.
 *
 * Ошибка транспорта — НЕ «пропал»: прерываем обход, ничего не помечаем,
 * пишем `error` в итог. Иначе одна недоступная 1С ночью пометила бы все
 * документы пропавшими, и утром люди перевыгружали бы то, что на месте.
 */
export async function reconcilePushedDocuments(
  prisma: PrismaClient,
  opts: { adapter?: OneCAdapter | undefined } = {}
): Promise<ReconcileDocumentsResult> {
  const startedAt = Date.now();
  const adapter = opts.adapter ?? getOneCAdapter();
  // Заменённые версии не спрашиваем: в 1С уехала действующая, и цепочка
  // сверяется по ней одной.
  const docs = await prisma.document.findMany({
    where: { oneCPushStatus: 'pushed', supersededAt: null },
    select: { id: true, replacesDocumentId: true, version: true, oneCExternalId: true },
    orderBy: { id: 'asc' },
  });

  const missing: string[] = [];
  let checked = 0;
  let error: string | null = null;
  let stoppedAt: string | null = null;

  for (const doc of docs) {
    const externalId = await reissueChainRootId(prisma, doc);
    let found;
    try {
      found = await adapter.findDocument(externalId);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      stoppedAt = doc.id;
      log.error('[oneCSync/reconcile] 1C lookup failed, stopping the pass', {
        documentId: doc.id,
        externalId,
        error,
      });
      break;
    }
    checked += 1;
    if (found) continue;

    missing.push(doc.id);
    // Условие по статусу: пока мы спрашивали 1С, документ могли поставить
    // на повторную выгрузку — `pending` не затираем.
    await prisma.document.updateMany({
      where: { id: doc.id, oneCPushStatus: 'pushed' },
      data: { oneCPushStatus: 'failed', oneCPushError: errorMessageRu(MISSING_IN_1C) },
    });
    await writeSyncLog(
      {
        entity: 'document',
        direction: 'outbound',
        operation: 'check',
        status: 'error',
        externalId: doc.id,
        errorMessage: MISSING_IN_1C,
        payload: {
          documentId: doc.id,
          externalId,
          oneCExternalId: doc.oneCExternalId,
          version: doc.version,
        },
      },
      prisma
    );
  }

  const unchecked = docs.length - checked;
  await writeSyncLog(
    {
      entity: 'reconcile',
      direction: 'outbound',
      operation: 'check',
      status: error ? 'error' : missing.length > 0 ? 'warn' : 'success',
      errorMessage: error ?? undefined,
      payload: { checked, missing, unchecked, ...(stoppedAt ? { stoppedAt } : {}) },
      durationMs: Date.now() - startedAt,
    },
    prisma
  );

  return { checked, missing, unchecked, error };
}

export type ReconcileLeadsResult = {
  /** Претензия снята, лид снова в очереди на отправку. */
  requeued: string[];
  /** Повтор уже был (или очередь недоступна) — записана ошибка. */
  stuck: string[];
};

/**
 * Лид «завис», если претензия на отправку (`pushedToOneCAt`) старше суток, а
 * подтверждения от 1С нет. Подтверждение — это либо `externalIdInOneC`, либо
 * `success`-строка в истории обмена: 1С вправе принять заявку без своего
 * номера (`oneCRequestId` в контракте необязателен), и такой лид отправлен
 * честно — его не трогаем.
 *
 * Зависший отправляем заново один раз: снимаем претензию и ставим задачу в
 * `oneCSync.pushLead` (1С дедуплицирует по `cabinetLeadId`, контракт §5).
 * Признак «уже повторяли» — `warn`-строка сверки за 48 часов; второй раз →
 * `error` в истории, лид остаётся как есть, партнёру уходит уведомление
 * (процессор). Само лечение `Д-26` в `push.ts` не меняем — сверка ловит
 * именно тот случай, когда откат претензии не удался.
 */
export async function reconcileStuckLeads(
  prisma: PrismaClient,
  opts: { now?: Date | undefined } = {}
): Promise<ReconcileLeadsResult> {
  const now = opts.now ?? new Date();
  const claimedBefore = new Date(now.getTime() - DAY_MS);
  const retriedSince = new Date(now.getTime() - LEAD_RETRY_MEMORY_MS);

  const leads = await prisma.lead.findMany({
    where: { pushedToOneCAt: { lt: claimedBefore }, externalIdInOneC: null },
    select: { id: true, pushedToOneCAt: true },
    orderBy: { pushedToOneCAt: 'asc' },
  });

  const requeued: string[] = [];
  const stuck: string[] = [];

  for (const lead of leads) {
    const accepted = await prisma.syncLog.findFirst({
      where: {
        entity: 'lead',
        direction: 'outbound',
        operation: 'create',
        status: 'success',
        payload: { path: ['cabinetLeadId'], equals: lead.id },
      },
      select: { id: true },
    });
    if (accepted) continue;

    const claimedAt = lead.pushedToOneCAt;
    const retried = await prisma.syncLog.findFirst({
      where: {
        entity: 'lead',
        direction: 'outbound',
        operation: 'check',
        status: 'warn',
        externalId: lead.id,
        createdAt: { gte: retriedSince },
      },
      select: { id: true },
    });
    if (retried) {
      await writeSyncLog(
        {
          entity: 'lead',
          direction: 'outbound',
          operation: 'check',
          status: 'error',
          externalId: lead.id,
          errorMessage: LEAD_STUCK,
          payload: { cabinetLeadId: lead.id, reason: 'stuck_claim', claimedAt, action: 'gave_up' },
        },
        prisma
      );
      stuck.push(lead.id);
      continue;
    }

    // Сначала снимаем претензию, потом ставим задачу: в обратном порядке
    // задача могла бы выполниться раньше снятия и увидеть «уже отправлен».
    await prisma.lead.updateMany({
      where: { id: lead.id, pushedToOneCAt: { not: null } },
      data: { pushedToOneCAt: null },
    });
    // try/catch, а не .catch(): getQueue бросает СИНХРОННО без REDIS_URL.
    try {
      const payload: PushLeadJobPayload = { leadId: lead.id };
      await getQueue('oneCSync.pushLead').add('push', payload, {
        jobId: `push-lead:${lead.id}:${Date.now()}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('[oneCSync/reconcile] stuck lead re-enqueue failed', {
        leadId: lead.id,
        error: message,
      });
      await writeSyncLog(
        {
          entity: 'lead',
          direction: 'outbound',
          operation: 'check',
          status: 'error',
          externalId: lead.id,
          errorMessage: message,
          payload: {
            cabinetLeadId: lead.id,
            reason: 'stuck_claim',
            claimedAt,
            action: 'requeue_failed',
          },
        },
        prisma
      );
      stuck.push(lead.id);
      continue;
    }
    await writeSyncLog(
      {
        entity: 'lead',
        direction: 'outbound',
        operation: 'check',
        status: 'warn',
        externalId: lead.id,
        payload: { cabinetLeadId: lead.id, reason: 'stuck_claim', claimedAt, action: 'requeued' },
      },
      prisma
    );
    requeued.push(lead.id);
  }

  return { requeued, stuck };
}
