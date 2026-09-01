import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { DOCUMENT_TEMPLATE_SLOTS, checkSlotText, findSlot } from '@/lib/documents/documentTemplate';

/**
 * Свои тексты абзацев договора и доп. соглашения (`У-160`).
 *
 * **Область правки задаёт РОЛЬ, а не форма.** Администратор правит шаблон
 * выбранной компании, руководитель — только своей; чужой `companyId`, пришедший
 * из формы, получает отказ, а не молчаливую подмену на свою компанию. Молчаливая
 * подмена выглядела бы как «сохранил, а изменений нет».
 *
 * **В базе только отличия.** Нет строки — печатается встроенный текст из
 * реестра слотов, поэтому «вернуть стандартный» удаляет строку, а не пишет
 * копию: копия заморозила бы формулировку на дату нажатия кнопки.
 *
 * **Номер редакции выдаёт счётчик компании.** Он растёт и при сохранении, и при
 * сбросе, никогда не переиспользуется, а выданное число штампуется в ту же
 * строку, что и текст. Поэтому «в документе одна редакция, а напечатана
 * другая» невыразимо даже при двух одновременных правках.
 */

export const SLOT_TEXT_MAX = 4000;

type Forbidden = { ok: false; error: 'forbidden' };
type NotFound = { ok: false; error: 'not_found' };
type SlotUnknown = { ok: false; error: 'unknown_slot' };
type TextTooLong = { ok: false; error: 'text_too_long' };
type TextEmpty = { ok: false; error: 'text_empty' };
type BadPlaceholder = {
  ok: false;
  error: 'unknown_placeholder' | 'missing_placeholder';
  tokens: string[];
};

export type TemplateRow = {
  slot: string;
  /** Текст, который увидит человек: свой либо встроенный. */
  body: string;
  /** `true` — компания завела свой текст; кнопка сброса показывается только тогда. */
  isCustom: boolean;
  revision: number | null;
  updatedAt: Date | null;
};

function guardCompany(session: SessionPayload, companyId: string): Forbidden | null {
  if (session.role !== 'admin' && session.role !== 'leader')
    return { ok: false, error: 'forbidden' };
  // Сравнение, а не подстановка: руководитель, приславший чужой id, обязан
  // получить отказ — иначе правка ушла бы в свою компанию незаметно для него.
  if (session.role === 'leader' && companyId !== session.companyId)
    return { ok: false, error: 'forbidden' };
  return null;
}

/**
 * Все абзацы компании: свои поверх встроенных.
 *
 * Возвращается ВЕСЬ реестр, а не только сохранённые строки: человек должен
 * видеть и то, что печатается сейчас, даже если он это ещё не правил.
 */
export async function listCompanyTemplates(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string
): Promise<{ ok: true; rows: TemplateRow[] } | Forbidden> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;

  const saved = await prisma.documentTemplate.findMany({
    where: { companyId },
    select: { slot: true, body: true, revision: true, updatedAt: true },
  });
  const bySlot = new Map(saved.map((r) => [r.slot, r]));

  return {
    ok: true,
    rows: DOCUMENT_TEMPLATE_SLOTS.map((slot) => {
      const own = bySlot.get(slot.key);
      return own
        ? {
            slot: slot.key,
            body: own.body,
            isCustom: true,
            revision: own.revision,
            updatedAt: own.updatedAt,
          }
        : {
            slot: slot.key,
            body: slot.defaultText,
            isCustom: false,
            revision: null,
            updatedAt: null,
          };
    }),
  };
}

type SaveResult =
  | { ok: true; revision: number }
  | Forbidden
  | NotFound
  | SlotUnknown
  | TextTooLong
  | TextEmpty
  | BadPlaceholder;

/**
 * Записать свой текст абзаца.
 *
 * Счётчик редакций и запись текста идут ОДНОЙ транзакцией: иначе два
 * одновременных сохранения могли бы получить один номер, и два разных текста
 * стали бы неразличимы в выпущенных документах.
 */
export async function saveCompanyTemplate(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { companyId: string; slot: string; body: string }
): Promise<SaveResult> {
  const denied = guardCompany(session, args.companyId);
  if (denied) return denied;

  const slot = findSlot(args.slot);
  if (!slot) return { ok: false, error: 'unknown_slot' };

  const body = args.body.trim();
  // Пустой текст — это не «свой текст», а отказ от него: для этого есть
  // «вернуть стандартный». Двух способов сказать одно и то же не заводим.
  if (!body) return { ok: false, error: 'text_empty' };
  if (body.length > SLOT_TEXT_MAX) return { ok: false, error: 'text_too_long' };

  const checked = checkSlotText(slot, body);
  if (!checked.ok) return { ok: false, error: checked.error, tokens: checked.tokens };

  // Компания могла исчезнуть между открытием экрана и сохранением: без этой
  // проверки нарушение внешнего ключа вылетело бы наружу как 500.
  const company = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { id: true },
  });
  if (!company) return { ok: false, error: 'not_found' };

  const revision = await prisma.$transaction(async (tx) => {
    const bumped = await tx.company.update({
      where: { id: args.companyId },
      data: { documentTemplateRevision: { increment: 1 } },
      select: { documentTemplateRevision: true },
    });
    const next = bumped.documentTemplateRevision;
    await tx.documentTemplate.upsert({
      where: { companyId_slot: { companyId: args.companyId, slot: slot.key } },
      create: {
        companyId: args.companyId,
        slot: slot.key,
        body,
        revision: next,
        updatedBy: session.sub,
      },
      update: { body, revision: next, updatedBy: session.sub },
    });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'document_template_changed',
      entity: 'document_template',
      // Ключ записи — компания: по журналу должно быть видно, чью бумагу
      // правили. Слот и редакция уточняют, что именно.
      entityId: args.companyId,
      // Самого текста здесь нет: он может содержать данные клиента.
      after: { slot: slot.key, revision: next, length: body.length },
    });
    return next;
  });

  return { ok: true, revision };
}

/**
 * «Вернуть стандартный» — УДАЛЕНИЕ своей строки.
 *
 * Не запись копии встроенного текста: копия была бы вторым источником правды и
 * разъехалась бы с программой при первой же правке формулировки.
 */
export async function resetCompanyTemplate(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { companyId: string; slot: string }
): Promise<{ ok: true } | Forbidden | SlotUnknown> {
  const denied = guardCompany(session, args.companyId);
  if (denied) return denied;
  const slot = findSlot(args.slot);
  if (!slot) return { ok: false, error: 'unknown_slot' };

  await prisma.$transaction(async (tx) => {
    // Счётчик растёт и на сбросе: документы, выпущенные до и после возврата к
    // стандартному тексту, не должны выглядеть одинаково в журнале.
    await tx.company.update({
      where: { id: args.companyId },
      data: { documentTemplateRevision: { increment: 1 } },
    });
    await tx.documentTemplate.deleteMany({ where: { companyId: args.companyId, slot: slot.key } });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'document_template_reset',
      entity: 'document_template',
      entityId: args.companyId,
      after: { slot: slot.key },
    });
  });

  return { ok: true };
}
