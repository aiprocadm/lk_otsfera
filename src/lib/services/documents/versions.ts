import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { isStaffManagerSide } from '@/lib/auth/roleModel';

/**
 * Новая версия ЗАГРУЖЕННОГО файла (`У-251`, этап 8).
 *
 * У выпущенных документов версии уже есть — это перевыпуск (`У-151`). У
 * загруженного файла заменить содержимое было нельзя вовсе: человек грузил
 * второй файл рядом, и в списке оказывались две одинаковые бумаги без указания,
 * какая из них действующая.
 *
 * Механизм тот же, что у перевыпуска (`Р-Э8-5`): новая СТРОКА со ссылкой
 * `replacesDocumentId` на прежнюю, `version + 1`, прежняя получает
 * `supersededAt` и уходит из списков по умолчанию. Второго способа «заменить
 * документ» в системе не появляется — иначе их пришлось бы держать в согласии
 * вечно.
 *
 * Здесь только ПРОВЕРКИ. Запись делает `persistUploadedDocument` одной
 * транзакцией: пометить прежнюю раньше — оставить контрагента без действующего
 * документа при сбое записи; позже — показать на секунду две действующие версии.
 */

/** Коды отказа общие для всех четырёх кабинетов: правило замены одно. */
export type ReplaceErrorCode =
  | 'not_found'
  | 'forbidden'
  /** Документ выпущен в ЛК — у него перевыпуск, а не загрузка версии. */
  | 'generated_document'
  /** Прежняя версия уже заменена: цепочку ветвить нельзя. */
  | 'already_superseded'
  /** Новый файл другого типа или другого контрагента — это другой документ. */
  | 'mismatch';

type IncomingDocument = {
  docType: string;
  counterparty: { type: 'organization' | 'partner'; id: string };
  orderId: string | null;
};

/**
 * Кто вправе заменить файл своей версией (§7 пакета требований):
 * **та роль, которая загрузила исходный файл, и сотрудники ЦО**.
 *
 * Без этого правила клиент заменил бы счёт, который ему выставили, своим
 * файлом — и в шкафу исполнителя лежала бы чужая бумага под прежним номером.
 * Загрузчик неизвестен (документ приехал из 1С или Битрикса) — заменять может
 * только сотрудник: спросить «а ты ли это грузил» больше не у кого.
 */
export function canReplaceUploader(session: SessionPayload, uploaderRole: string | null): boolean {
  if (isStaffManagerSide(session) || session.role === 'admin') return true;
  return uploaderRole !== null && uploaderRole === session.role;
}

/**
 * Разрешить замену и вернуть то, что нужно записи: идентификатор прежней
 * версии и её номер.
 *
 * `replacesDocumentId` не пришёл — обычная загрузка, `replaces: undefined`. Так
 * у четырёх кабинетов остаётся одна ветка кода вместо «если версия — сюда,
 * иначе — туда», и правило замены живёт в единственном месте.
 *
 * Скоуп проверяется ТОЙ ЖЕ функцией, что и скачивание (`canReadDocument`):
 * второй набор правил доступа разъехался бы с первым на первой же правке.
 */
export async function resolveReplaces(
  prisma: PrismaClient,
  session: SessionPayload,
  replacesDocumentId: string | null | undefined,
  incoming: IncomingDocument
): Promise<
  | { ok: true; replaces: { id: string; version: number } | undefined }
  | { ok: false; error: ReplaceErrorCode }
> {
  if (!replacesDocumentId) return { ok: true, replaces: undefined };

  const doc = await prisma.document.findUnique({
    where: { id: replacesDocumentId },
    select: {
      id: true,
      version: true,
      type: true,
      status: true,
      direction: true,
      counterpartyType: true,
      counterpartyId: true,
      orderId: true,
      companyId: true,
      number: true,
      createdAt: true,
      generatedBy: true,
      supersededAt: true,
      // §7 пакета: версию грузит роль, которая загрузила исходный файл.
      uploadedBy: { select: { role: true } },
      order: { select: { companyId: true } },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'forbidden' };
  if (!canReplaceUploader(session, doc.uploadedBy?.role ?? null)) {
    return { ok: false, error: 'forbidden' };
  }

  // Выпущенный в ЛК документ заменяется перевыпуском (`У-151`) — у него свой
  // номер и своя нумерация. Две двери к одному шкафу разошлись бы правилами.
  if (doc.generatedBy !== 'user') return { ok: false, error: 'generated_document' };
  if (doc.supersededAt !== null) return { ok: false, error: 'already_superseded' };

  // Другой тип или другой контрагент — это не новая версия, а новый документ.
  const sameCounterparty =
    doc.counterpartyType === incoming.counterparty.type &&
    doc.counterpartyId === incoming.counterparty.id;
  const sameOrder = (doc.orderId ?? null) === (incoming.orderId ?? null);
  if (doc.type !== incoming.docType || !sameCounterparty || !sameOrder) {
    return { ok: false, error: 'mismatch' };
  }

  return { ok: true, replaces: { id: doc.id, version: doc.version } };
}

export type VersionRow = {
  id: string;
  version: number;
  name: string;
  createdAt: Date;
  uploadedByName: string | null;
  /** `null` у действующей версии. */
  supersededAt: Date | null;
};

/**
 * Цепочка версий документа — от самой старой к действующей.
 *
 * Идём по `replacesDocumentId` вверх от переданного документа, потом вниз по
 * тем, кто ссылается на него. Цепочка короткая (единицы версий), поэтому
 * обходим её запросами по ссылке, а не рекурсивным SQL: читаемость дороже.
 * Предел в 50 шагов — страховка от кольца, которого не должно быть.
 */
export async function getVersionChain(
  prisma: PrismaClient,
  documentId: string
): Promise<VersionRow[]> {
  const select = {
    id: true,
    version: true,
    name: true,
    createdAt: true,
    supersededAt: true,
    replacesDocumentId: true,
    uploadedBy: { select: { name: true, email: true } },
  };
  const start = await prisma.document.findUnique({ where: { id: documentId }, select });
  if (!start) return [];

  const chain = [start];
  const MAX_STEPS = 50;

  let cursor = start;
  for (let i = 0; i < MAX_STEPS && cursor.replacesDocumentId; i += 1) {
    const prev = await prisma.document.findUnique({
      where: { id: cursor.replacesDocumentId },
      select,
    });
    if (!prev) break;
    chain.unshift(prev);
    cursor = prev;
  }

  cursor = start;
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const next = await prisma.document.findFirst({
      where: { replacesDocumentId: cursor.id },
      select,
    });
    if (!next) break;
    chain.push(next);
    cursor = next;
  }

  return chain.map((d) => ({
    id: d.id,
    version: d.version,
    name: d.name,
    createdAt: d.createdAt,
    uploadedByName: d.uploadedBy ? d.uploadedBy.name || d.uploadedBy.email : null,
    supersededAt: d.supersededAt,
  }));
}
