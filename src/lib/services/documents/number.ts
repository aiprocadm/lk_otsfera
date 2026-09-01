import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { recordAudit } from '@/lib/auth/audit';
import { canReadDocument } from '@/lib/auth/policy';
import { companyScopeWhere } from './generate';

/**
 * Номер документу, приехавшему из 1С (`У-151`, дефект `Д-5`).
 *
 * 1С отдаёт счета и договоры **без номера**: поле `number` у них пустое.
 * Раньше такой счёт включал кнопку «Акт», а выпуск падал «сначала выпустите
 * счёт» — человек видел счёт на экране и не понимал отказа. Теперь ему
 * предлагают вписать номер с бумаги, и после этого акт выпускается как обычно.
 *
 * **Проставить номер можно только один раз и только тому, у кого его нет.**
 * Номер уже выпущенного нами документа напечатан в PDF и назван в имени файла:
 * поменять его в базе значило бы развести бумагу и запись.
 */

type Result =
  | { ok: true }
  | {
      ok: false;
      error: 'forbidden' | 'not_found' | 'number_present' | 'number_invalid' | 'number_taken';
    };

/** Тот же предел, что у номера из генератора: «ДС-2026-1234» и запас. */
const MAX_NUMBER_LENGTH = 64;

export async function setDocumentNumber(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { documentId: string; number: string }
): Promise<Result> {
  // Номер — часть бумаги, а не заметка: правит сотрудник ЦО, не клиент.
  if (!isStaffManagerSide(session) && session.role !== 'admin')
    return { ok: false, error: 'forbidden' };

  const number = args.number.trim();
  if (!number || number.length > MAX_NUMBER_LENGTH) return { ok: false, error: 'number_invalid' };

  const doc = await prisma.document.findUnique({
    where: { id: args.documentId },
    select: {
      id: true,
      number: true,
      type: true,
      // `У-164`: гейту чтения нужно состояние — черновик КП клиенту не
      // показывается, и без этого поля он сходил бы в базу второй раз.
      status: true,
      version: true,
      companyId: true,
      orderId: true,
      counterpartyType: true,
      counterpartyId: true,
      order: { select: { companyId: true } },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  // Тот же предикат, что у скачивания: скоуп не изобретается заново (§4).
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'not_found' };
  if (doc.number) return { ok: false, error: 'number_present' };

  const companyId = doc.companyId ?? doc.order?.companyId ?? null;
  // Компания нужна, чтобы проверить занятость номера. Без неё документ —
  // сирота, и вписывать ему номер небезопасно: проверять не с чем.
  if (!companyId) return { ok: false, error: 'not_found' };

  // Тот же скоуп компании, что у выпуска: два независимых условия разъехались
  // бы при первой правке. Окно гонки закрывает уникальный индекс миграции
  // данных (PR-8b); до него защищает эта проверка.
  const clash = await prisma.document.findFirst({
    where: {
      ...companyScopeWhere(companyId),
      type: doc.type,
      number,
      version: doc.version,
    },
    select: { id: true },
  });
  if (clash) return { ok: false, error: 'number_taken' };

  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { number } });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'document_number_set',
      entity: 'document',
      entityId: doc.id,
      after: { number },
    });
  });

  return { ok: true };
}
