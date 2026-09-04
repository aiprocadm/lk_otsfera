import type { DocumentType, OneCDocumentPushMode, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { recordAudit } from '@/lib/auth/audit';
import { enqueueDocumentPush } from '@/lib/services/oneCSync/pushDocument';
import { isOneCPushableType } from '@/lib/services/oneCSync/schemas';

/**
 * Этап 8 (`У-169`, `У-159`) — кнопка «Выгрузить в 1С» и «Повторить».
 *
 * Продюсер очереди (`enqueueDocumentPush`) знает только документ: тип, версия,
 * занят ли он уже. Здесь — то, что должно решаться ДО очереди и от имени
 * человека: кто нажал (сотрудник исполнителя, и документ ему виден), что
 * говорит правило компании (`У-169`: `never` или тип вне набора — кнопки нет
 * и на сервере тоже), и не пришла ли бумага САМА из 1С (обратно её не
 * возят). Скрытая кнопка правами не считается (§4 CLAUDE.md) — каждая из
 * этих проверок живёт тут, а не только в компоненте.
 *
 * Повтор после ошибки — та же дверь: `retry: true` в событии журнала, чтобы
 * по нему было видно, что человек перезапустил выгрузку руками, а не она
 * пошла сама (`У-159`).
 */

/** Почему у документа нет кнопки «Выгрузить в 1С» (карточка показывает объяснение вместо неё). */
export type OneCPushBlockReason = 'not_pushable_type' | 'from_1c' | 'push_disabled' | 'superseded';

type BlockCheckInput = {
  type: string;
  /** Заполнен у документа, пришедшего ИЗ 1С импортом. */
  externalId: string | null;
  supersededAt: Date | null;
  company: {
    oneCDocumentPushMode: OneCDocumentPushMode;
    oneCDocumentPushTypes: DocumentType[];
  };
};

/**
 * Одна проверка для карточки (что показать) и сервиса (что разрешить):
 * порядок — от «никогда не выгрузится» к «сейчас нельзя».
 *
 * Набор типов правила ограничивает и РУЧНУЮ выгрузку, не только `auto`:
 * компания, снявшая флажок «договор», сняла его сознательно, и кнопка,
 * которая всё равно отправит договор, обесценила бы настройку.
 */
export function oneCPushBlockReason(doc: BlockCheckInput): OneCPushBlockReason | null {
  if (!isOneCPushableType(doc.type)) return 'not_pushable_type';
  if (doc.externalId) return 'from_1c';
  if (doc.company.oneCDocumentPushMode === 'never') return 'push_disabled';
  if (!doc.company.oneCDocumentPushTypes.includes(doc.type)) return 'push_disabled';
  if (doc.supersededAt) return 'superseded';
  return null;
}

type RequestDocumentPushError =
  | 'forbidden'
  | 'not_found'
  | OneCPushBlockReason
  | 'already_queued'
  | 'queue_unavailable';

export type RequestDocumentPushResult =
  | { ok: true; retry: boolean }
  | { ok: false; error: RequestDocumentPushError };

const PUSH_SELECT = {
  id: true,
  type: true,
  status: true,
  number: true,
  externalId: true,
  supersededAt: true,
  oneCPushStatus: true,
  companyId: true,
  counterpartyType: true,
  counterpartyId: true,
  orderId: true,
  order: { select: { companyId: true } },
  company: { select: { oneCDocumentPushMode: true, oneCDocumentPushTypes: true } },
} as const;

export async function requestDocumentPush(
  prisma: PrismaClient,
  session: SessionPayload,
  documentId: string
): Promise<RequestDocumentPushResult> {
  // Выгружает сотрудник исполнителя: заказчику и партнёру 1С исполнителя
  // не принадлежит, и кнопки у них нет ни на экране, ни здесь.
  if (!(session.role === 'admin' || isStaffManagerSide(session))) {
    return { ok: false, error: 'forbidden' };
  }

  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: PUSH_SELECT });
  if (!doc) return { ok: false, error: 'not_found' };
  // Тот же предикат, что у скачивания (§4 CLAUDE.md): менеджер ставит в
  // очередь только документы своего скоупа; отказ и отсутствие неотличимы.
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'not_found' };

  const blocked = oneCPushBlockReason(doc);
  if (blocked) return { ok: false, error: blocked };
  if (doc.oneCPushStatus === 'pending') return { ok: false, error: 'already_queued' };

  const retry = doc.oneCPushStatus === 'failed';
  const queued = await enqueueDocumentPush(prisma, doc.id, { actorUserId: session.sub });
  if (!queued.ok) return { ok: false, error: queued.error };

  // `У-159`: сама выгрузка запишется процессором (`document_pushed_to_1c` /
  // `…_failed`), но между кнопкой и задачей может пройти время — кто и когда
  // нажал, журнал должен знать сразу.
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'document_push_to_1c_requested',
    entity: 'document',
    entityId: doc.id,
    after: { retry, type: doc.type, number: doc.number, previousStatus: doc.oneCPushStatus },
  });
  return { ok: true, retry };
}

export type RequestDocumentPushManyResult =
  | {
      ok: true;
      /** Сколько документов поставлено в очередь. */
      queued: number;
      /** Что пропущено и почему — списку есть что показать человеку, а не «часть не вышла». */
      skipped: Array<{ documentId: string; error: RequestDocumentPushError }>;
    }
  | { ok: false; error: 'forbidden' };

/**
 * Массовое действие списка (`У-169`): каждый документ проходит ту же
 * проверку, что и по одиночной кнопке. Один пропущенный не мешает
 * остальным — итог честно делится на «поставлено» и «пропущено».
 */
export async function requestDocumentPushMany(
  prisma: PrismaClient,
  session: SessionPayload,
  documentIds: readonly string[]
): Promise<RequestDocumentPushManyResult> {
  if (!(session.role === 'admin' || isStaffManagerSide(session))) {
    return { ok: false, error: 'forbidden' };
  }
  let queued = 0;
  const skipped: Array<{ documentId: string; error: RequestDocumentPushError }> = [];
  // Последовательно, а не `Promise.all`: у каждой постановки — своя проверка
  // прав и запись в журнал, и десяток параллельных запросов к базе и Redis
  // ради «быстрее» тут ничего не выигрывает.
  for (const documentId of new Set(documentIds)) {
    const res = await requestDocumentPush(prisma, session, documentId);
    if (res.ok) queued += 1;
    else skipped.push({ documentId, error: res.error });
  }
  return { ok: true, queued, skipped };
}
