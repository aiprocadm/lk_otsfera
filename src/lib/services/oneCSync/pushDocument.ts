import type { CounterpartyType, PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';
import { errorMessageRu } from '@/lib/errors/messages';
import { getQueue } from '@/lib/jobs/queues';
import type { PushDocumentJobPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';
import { getObjectStorage } from '@/lib/storage';
import { CATALOG_UNIT_LABELS } from '@/lib/services/admin/catalogItems';
import { getOneCAdapter, type OneCAdapter } from '.';
import type { OneCDocumentPushPayload } from './dto';
import { writeSyncLog } from './log';
import { isOneCPushableType, type OneCPushableType } from './schemas';

/**
 * Этап 8 (`У-167`, `У-168`): выгрузка документа кабинета в 1С.
 *
 * Два входа. `enqueueDocumentPush` — продюсер очереди `oneCSync.pushDocument`
 * (кнопка «Выгрузить», правило `auto` при выпуске): ставит `pending` и кладёт
 * задачу; сбой постановки не роняет вызывающего (§3 CLAUDE.md).
 * `pushDocumentToOneC` — то, что делает процессор воркера: собирает тело по
 * контракту (docs/integrations/1c-contract.md, секция 6), зовёт адаптер и
 * записывает исход в шесть полей `Document`.
 *
 * Идемпотентность держится на версии (спека 3.1): `pushed` с той же
 * `oneCPushedVersion` — повтор не нужен, адаптер не зовётся. Перевыпуск
 * поднимает `version`, и бумага уезжает обновлением под ТЕМ ЖЕ `externalId` —
 * id первой версии цепочки (секция 7 контракта).
 */

/** Ссылка на PDF для 1С живёт дольше обычной (600 с): 1С забирает файл своим расписанием (спека 3.4). */
export const ONE_C_FILE_URL_TTL_SECONDS = 3600;

/** Предел глубины цепочки перевыпусков при поиске корня — защита от цикла в данных. */
const MAX_REISSUE_CHAIN_DEPTH = 100;

/** Окончательные отказы: повтор задачи не поможет, пока человек не поправит документ. */
export type PushDocumentRefusal =
  | 'not_found'
  | 'not_pushable_type'
  | 'superseded'
  | 'counterparty_without_inn'
  | 'no_number';

export type PushDocumentResult =
  | { ok: true; oneCExternalId: string | null; skipped: 'same_version' | null }
  | { ok: false; error: PushDocumentRefusal }
  /** Адаптер не смог — транзиентно, задачу стоит повторить (BullMQ retry). */
  | { ok: false; error: 'push_failed'; message: string };

export type PushDocumentOptions = {
  adapter?: OneCAdapter | undefined;
  /** От чьего имени пишется событие аудита (`У-159`); без него — от автора документа. */
  actorUserId?: string | undefined;
};

export type EnqueueDocumentPushResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'not_found'
        | 'not_pushable_type'
        | 'superseded'
        | 'already_queued'
        | 'queue_unavailable';
    };

const num = (d: { toNumber(): number }): number => d.toNumber();

/**
 * id ПЕРВОЙ версии цепочки перевыпусков (`У-151`) — общий `externalId` для 1С.
 * Ходим по `replacesDocumentId` до документа, который никого не заменяет.
 */
async function reissueChainRootId(
  prisma: PrismaClient,
  doc: { id: string; replacesDocumentId: string | null }
): Promise<string> {
  let current = doc;
  let depth = 0;
  while (current.replacesDocumentId) {
    depth += 1;
    if (depth > MAX_REISSUE_CHAIN_DEPTH) {
      throw new Error(
        `reissue chain of document ${doc.id} is deeper than ${MAX_REISSUE_CHAIN_DEPTH}`
      );
    }
    current = await prisma.document.findUniqueOrThrow({
      where: { id: current.replacesDocumentId },
      select: { id: true, replacesDocumentId: true },
    });
  }
  return current.id;
}

type Counterparty = OneCDocumentPushPayload['counterparty'];

/**
 * Реквизиты контрагента. `null` — контрагента нет или у него нет ИНН: по
 * контракту 1С без ИНН документ не примет, а пустой контрагент у выгружаемых
 * типов невозможен по ограничению базы (только у КП) — обе ветки сводятся к
 * одному отказу `counterparty_without_inn`.
 */
async function loadCounterparty(
  prisma: PrismaClient,
  type: CounterpartyType | null,
  id: string | null
): Promise<Counterparty | null> {
  if (type === null || id === null) return null;
  const select = { inn: true, kpp: true, name: true, legalName: true } as const;
  const row =
    type === 'organization'
      ? await prisma.organization.findUnique({ where: { id }, select })
      : await prisma.partner.findUnique({ where: { id }, select });
  if (!row?.inn) return null;
  return { inn: row.inn, kpp: row.kpp, name: row.name, legalName: row.legalName };
}

const documentSelect = {
  id: true,
  type: true,
  number: true,
  version: true,
  createdAt: true,
  path: true,
  supersededAt: true,
  replacesDocumentId: true,
  counterpartyType: true,
  counterpartyId: true,
  uploadedById: true,
  oneCPushStatus: true,
  oneCPushedVersion: true,
  oneCExternalId: true,
  amountNet: true,
  amountVat: true,
  amountGross: true,
  order: { select: { externalId: true, orderNumber: true } },
  parentDocument: { select: { id: true, number: true, replacesDocumentId: true } },
  lines: {
    orderBy: { sortOrder: 'asc' },
    select: {
      title: true,
      quantity: true,
      unit: true,
      unitPrice: true,
      vatRate: true,
      vatAmount: true,
      amount: true,
    },
  },
} as const;

function loadDocument(prisma: PrismaClient, documentId: string) {
  return prisma.document.findUnique({ where: { id: documentId }, select: documentSelect });
}

type LoadedDocument = NonNullable<Awaited<ReturnType<typeof loadDocument>>>;

/** Итоги на момент выпуска; у legacy-документов (до этапа 6) их нет — `null`, как и строк. */
function toTotals(doc: LoadedDocument): OneCDocumentPushPayload['totals'] {
  const { amountNet, amountVat, amountGross } = doc;
  if (amountNet === null || amountVat === null || amountGross === null) return null;
  return { net: num(amountNet), vat: num(amountVat), gross: num(amountGross) };
}

type BuildPayloadResult =
  | { ok: true; payload: OneCDocumentPushPayload }
  | { ok: false; error: 'counterparty_without_inn' | 'no_number' };

/**
 * Тело выгрузки по контракту. Отказы — стабильными кодами, а не падением на
 * `OneCDocumentPushSchema.parse`: человек должен увидеть «нет ИНН», а не
 * «invalid body».
 */
async function buildPayload(
  prisma: PrismaClient,
  doc: LoadedDocument,
  type: OneCPushableType,
  externalId: string
): Promise<BuildPayloadResult> {
  const counterparty = await loadCounterparty(prisma, doc.counterpartyType, doc.counterpartyId);
  if (!counterparty) return { ok: false, error: 'counterparty_without_inn' };
  if (!doc.number) return { ok: false, error: 'no_number' };

  // Основание («акт → счёт», «ДС → договор») уезжает тем же корневым id, что
  // и оно само при своей выгрузке — иначе 1С не свяжет две бумаги. Основание
  // без номера (только загрузка или импорт) для 1С не адресуемо — связь не
  // передаём, бумага уезжает сама по себе.
  const parent = doc.parentDocument;
  const parentDocument = parent?.number
    ? { externalId: await reissueChainRootId(prisma, parent), number: parent.number }
    : null;

  // Legacy-документы без строк уезжают без строк (спека 3.5): `null`, а не `[]`.
  const lines =
    doc.lines.length === 0
      ? null
      : doc.lines.map((l) => ({
          title: l.title,
          quantity: num(l.quantity),
          unit: CATALOG_UNIT_LABELS[l.unit],
          price: num(l.unitPrice),
          vatRate: l.vatRate === null ? null : num(l.vatRate),
          vatAmount: num(l.vatAmount),
          amount: num(l.amount),
        }));

  const fileUrl = await getObjectStorage().createSignedUrl(doc.path, ONE_C_FILE_URL_TTL_SECONDS);

  return {
    ok: true,
    payload: {
      externalId,
      type,
      number: doc.number,
      date: doc.createdAt.toISOString(),
      version: doc.version,
      counterparty,
      order: doc.order
        ? { externalId: doc.order.externalId, orderNumber: doc.order.orderNumber }
        : null,
      parentDocument,
      lines,
      totals: toTotals(doc),
      fileUrl,
    },
  };
}

/**
 * Событие журнала (`У-159`). Пишется от имени того, кто попросил выгрузку, а
 * без него — от автора документа; ни того ни другого (документ из импорта,
 * задача без актора) — события нет, след остаётся в `SyncLog`. Падение аудита
 * не отменяет уже состоявшуюся выгрузку (§3): только `log.error`.
 */
async function auditPush(
  prisma: PrismaClient,
  doc: { id: string; uploadedById: string | null },
  actorUserId: string | undefined,
  outcome: {
    action: 'document_pushed_to_1c' | 'document_push_to_1c_failed';
    after: Record<string, unknown>;
  }
): Promise<void> {
  const userId = actorUserId ?? doc.uploadedById;
  if (!userId) return;
  try {
    await recordAudit(prisma, {
      userId,
      action: outcome.action,
      entity: 'document',
      entityId: doc.id,
      after: outcome.after,
    });
  } catch (err) {
    log.error('[pushDocumentToOneC] audit write failed', {
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type SyncLogContext = { operation: 'create' | 'update'; startedAt: number };

/** Отказ, после которого документ ждёт человека: `failed` + текст ошибки + счётчик. */
async function markFailed(
  prisma: PrismaClient,
  doc: LoadedDocument,
  actorUserId: string | undefined,
  message: string,
  ctx: SyncLogContext
): Promise<void> {
  await prisma.document.update({
    where: { id: doc.id },
    data: {
      oneCPushStatus: 'failed',
      oneCPushError: message,
      oneCPushAttempts: { increment: 1 },
    },
  });
  await auditPush(prisma, doc, actorUserId, {
    action: 'document_push_to_1c_failed',
    after: { version: doc.version, error: message },
  });
  await writeSyncLog(
    {
      entity: 'document',
      direction: 'outbound',
      operation: ctx.operation,
      status: 'error',
      externalId: doc.id,
      errorMessage: message,
      payload: { documentId: doc.id, version: doc.version },
      durationMs: Date.now() - ctx.startedAt,
    },
    prisma
  );
}

/**
 * КП и прочие типы вне контракта (`Р-14`) и заменённые версии (`У-151`):
 * выгружать нечего, поля не трогаем — только снимаем `pending`, если задачу
 * успели поставить до перевыпуска.
 */
async function refuseUntouched(
  prisma: PrismaClient,
  doc: LoadedDocument,
  refusal: 'not_pushable_type' | 'superseded'
): Promise<PushDocumentResult> {
  await prisma.document.updateMany({
    where: { id: doc.id, oneCPushStatus: 'pending' },
    data: { oneCPushStatus: 'none' },
  });
  await writeSyncLog(
    {
      entity: 'document',
      direction: 'outbound',
      operation: 'skip',
      status: 'warn',
      externalId: doc.id,
      errorMessage: refusal,
      payload: { documentId: doc.id, type: doc.type, version: doc.version },
    },
    prisma
  );
  return { ok: false, error: refusal };
}

export async function pushDocumentToOneC(
  prisma: PrismaClient,
  documentId: string,
  opts: PushDocumentOptions = {}
): Promise<PushDocumentResult> {
  const startedAt = Date.now();
  const doc = await loadDocument(prisma, documentId);
  if (!doc) {
    await writeSyncLog(
      {
        entity: 'document',
        direction: 'outbound',
        operation: 'create',
        status: 'error',
        externalId: documentId,
        errorMessage: 'Document not found',
      },
      prisma
    );
    return { ok: false, error: 'not_found' };
  }
  if (!isOneCPushableType(doc.type)) return refuseUntouched(prisma, doc, 'not_pushable_type');
  if (doc.supersededAt) return refuseUntouched(prisma, doc, 'superseded');

  // Спека 3.1: та же версия уже в 1С — повтор не нужен, адаптер не зовём.
  if (doc.oneCPushStatus === 'pushed' && doc.oneCPushedVersion === doc.version) {
    await writeSyncLog(
      {
        entity: 'document',
        direction: 'outbound',
        operation: 'skip',
        status: 'success',
        externalId: doc.id,
        payload: { documentId: doc.id, version: doc.version, reason: 'same_version' },
      },
      prisma
    );
    return { ok: true, oneCExternalId: doc.oneCExternalId, skipped: 'same_version' };
  }

  // Первая выгрузка цепочки — `create`; перевыпуск (корень цепочки — другой
  // документ) и повтор по уже известному 1С документу — `update`. На этом
  // различии держится история попыток (`У-174`).
  const externalId = await reissueChainRootId(prisma, doc);
  const ctx: SyncLogContext = {
    operation: externalId !== doc.id || doc.oneCExternalId ? 'update' : 'create',
    startedAt,
  };
  const built = await buildPayload(prisma, doc, doc.type, externalId);
  if (!built.ok) {
    await markFailed(prisma, doc, opts.actorUserId, errorMessageRu(built.error), ctx);
    return { ok: false, error: built.error };
  }
  const { payload } = built;
  const adapter = opts.adapter ?? getOneCAdapter();

  try {
    const result = await adapter.pushDocument(payload);
    await prisma.document.update({
      where: { id: doc.id },
      data: {
        oneCPushStatus: 'pushed',
        oneCExternalId: result.externalId,
        oneCPushedAt: new Date(),
        oneCPushedVersion: doc.version,
        oneCPushError: null,
        oneCPushAttempts: { increment: 1 },
      },
    });
    await auditPush(prisma, doc, opts.actorUserId, {
      action: 'document_pushed_to_1c',
      after: { version: doc.version, externalId, oneCExternalId: result.externalId },
    });
    await writeSyncLog(
      {
        entity: 'document',
        direction: 'outbound',
        operation: ctx.operation,
        status: 'success',
        externalId: doc.id,
        payload: {
          documentId: doc.id,
          externalId,
          version: doc.version,
          oneCExternalId: result.externalId,
        },
        durationMs: Date.now() - startedAt,
      },
      prisma
    );
    return { ok: true, oneCExternalId: result.externalId, skipped: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(prisma, doc, opts.actorUserId, message, ctx);
    return { ok: false, error: 'push_failed', message };
  }
}

/**
 * Продюсер очереди `oneCSync.pushDocument`. Сначала `pending` — это и есть
 * защита от двойной постановки (`already_queued`), потом задача. Упала
 * постановка (нет Redis) — статус возвращается, ошибка в лог, вызывающий
 * получает `queue_unavailable`, а не исключение: выпуск документа состояться
 * обязан и без очереди (спека 3.3).
 */
export async function enqueueDocumentPush(
  prisma: PrismaClient,
  documentId: string,
  opts: { actorUserId?: string | undefined } = {}
): Promise<EnqueueDocumentPushResult> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, type: true, supersededAt: true, oneCPushStatus: true },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  if (!isOneCPushableType(doc.type)) return { ok: false, error: 'not_pushable_type' };
  if (doc.supersededAt) return { ok: false, error: 'superseded' };

  const claimed = await prisma.document.updateMany({
    where: { id: doc.id, oneCPushStatus: { not: 'pending' } },
    data: { oneCPushStatus: 'pending' },
  });
  if (claimed.count === 0) return { ok: false, error: 'already_queued' };

  // try/catch, а не .catch(): getQueue → getRedisConnection бросает СИНХРОННО
  // при отсутствующем REDIS_URL.
  try {
    const payload: PushDocumentJobPayload = { documentId: doc.id, actorUserId: opts.actorUserId };
    await getQueue('oneCSync.pushDocument').add('push', payload);
    return { ok: true };
  } catch (err) {
    log.error('[oneCSync] document push enqueue failed', {
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Возвращаем прежний статус, чтобы кнопка «Выгрузить» осталась доступной.
    // Если и это не вышло (база легла в ту же секунду) — документ останется
    // `pending`; это видно в логе, а не в исключении наружу.
    try {
      await prisma.document.update({
        where: { id: doc.id },
        data: { oneCPushStatus: doc.oneCPushStatus },
      });
    } catch (rollbackErr) {
      log.error('[oneCSync] document push status rollback failed — document left pending', {
        documentId: doc.id,
        error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
    }
    return { ok: false, error: 'queue_unavailable' };
  }
}
