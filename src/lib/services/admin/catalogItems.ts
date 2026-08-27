import type { CatalogUnit, Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Этап 5 ТЗ (`У-136`, решение `Р-13`) — каталог услуг и товаров компании.
 *
 * Скоуп как у реквизитов исполнителя: админ — любая компания (выбирает явно),
 * руководитель — только своя, граница проверяется СРАВНЕНИЕМ, а не тихой
 * подменой. Использованный элемент не удаляется физически — только
 * деактивация (`isActive = false`): на него ссылаются строки заказов.
 * История изменений цены — журнал аудита (`catalog_item_updated`,
 * `before`/`after`), отдельной модели истории нет (спека §7-4).
 */

/** Русские подписи единиц измерения — закрытый список из ТЗ (спека §7-2). */
export const CATALOG_UNIT_LABELS: Record<CatalogUnit, string> = {
  person: 'чел.',
  piece: 'шт.',
  service: 'услуга',
  hour: 'час',
  month: 'месяц',
};

/** Допустимые ставки НДС (`У-138`): доли, null = «не облагается» (УСН). */
export const VAT_RATES = [0, 0.05, 0.07, 0.1, 0.2] as const;

export type CatalogItemRow = {
  id: string;
  name: string;
  code: string;
  unit: CatalogUnit;
  /** Decimal через границу не проходит — строка фиксированной точности. */
  price: string;
  vatRate: string | null;
  vatIncluded: boolean;
  directionId: string | null;
  directionName: string | null;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
};

export type CatalogItemInput = {
  name: string;
  code: string;
  unit: CatalogUnit;
  /** Цена строкой из формы («1 234,56» → нормализуется здесь). */
  price: string;
  /** Ставка НДС строкой-долей («0.2») либо null = не облагается. */
  vatRate: string | null;
  vatIncluded: boolean;
  directionId: string | null;
  description: string | null;
  sortOrder: number;
};

type Forbidden = { ok: false; error: 'forbidden' };
type NotFound = { ok: false; error: 'not_found' };
type Validation = { ok: false; error: 'validation'; messages: string[] };
type DuplicateCode = { ok: false; error: 'duplicate_code' };

const ROW_SELECT = {
  id: true,
  name: true,
  code: true,
  unit: true,
  price: true,
  vatRate: true,
  vatIncluded: true,
  directionId: true,
  direction: { select: { name: true } },
  description: true,
  isActive: true,
  sortOrder: true,
} satisfies Prisma.CatalogItemSelect;

type RowPayload = Prisma.CatalogItemGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(i: RowPayload): CatalogItemRow {
  return {
    id: i.id,
    name: i.name,
    code: i.code,
    unit: i.unit,
    price: i.price.toFixed(2),
    vatRate: i.vatRate === null ? null : i.vatRate.toString(),
    vatIncluded: i.vatIncluded,
    directionId: i.directionId,
    directionName: i.direction?.name ?? null,
    description: i.description,
    isActive: i.isActive,
    sortOrder: i.sortOrder,
  };
}

/**
 * Доступ и граница компании: staff-роли admin|leader; руководитель — только
 * своя компания (сравнение: чужой id из формы — ошибка вызова, её надо
 * видеть, а не молча подменять).
 */
function guardCompany(session: SessionPayload, companyId: string): Forbidden | null {
  if (session.role !== 'admin' && session.role !== 'leader') {
    return { ok: false, error: 'forbidden' };
  }
  if (session.role === 'leader' && companyId !== session.companyId) {
    return { ok: false, error: 'forbidden' };
  }
  return null;
}

function normalizePrice(raw: string): string | null {
  const cleaned = raw.replace(/\s| /g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  if (Number(cleaned) > 999_999_999_999.99) return null;
  // Всегда две цифры после точки: иначе аудит показывал бы фантомную смену
  // «100 → 100.00» (тот же класс, что формат vatRate — ревью PR-2).
  return Number(cleaned).toFixed(2);
}

/**
 * Общая построчная валидация: её же использует Excel-импорт (`У-137`) —
 * правила у формы и файла одни, дублирование разъехалось бы молча.
 */
export function validateCatalogItemInput(input: CatalogItemInput):
  | { ok: true; data: Omit<CatalogItemInput, 'price' | 'vatRate'> & { price: string; vatRate: string | null } }
  | Validation {
  const messages: string[] = [];
  const name = input.name.trim();
  const code = input.code.trim();
  if (!name || name.length > 300) messages.push('Название: от 1 до 300 символов');
  if (!code || code.length > 64) messages.push('Артикул: от 1 до 64 символов');
  const price = normalizePrice(input.price);
  if (price === null) messages.push('Цена: неотрицательное число, максимум две цифры после запятой');
  let vatRate: string | null = null;
  if (input.vatRate !== null) {
    const rate = Number(input.vatRate);
    if (!VAT_RATES.includes(rate as (typeof VAT_RATES)[number])) {
      messages.push('Ставка НДС: 0%, 5%, 7%, 10%, 20% или «не облагается»');
    } else {
      vatRate = rate.toFixed(4);
    }
  }
  const description = input.description?.trim() || null;
  if (description && description.length > 2000) messages.push('Описание: до 2000 символов');
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 100_000) {
    messages.push('Порядок: целое число от 0 до 100000');
  }
  if (messages.length) return { ok: false, error: 'validation', messages };
  return {
    ok: true,
    data: { ...input, name, code, price: price!, vatRate, description },
  };
}

export async function listCatalogItems(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { companyId: string; q?: string; includeInactive?: boolean; limit?: number }
): Promise<{ ok: true; items: CatalogItemRow[]; total: number } | Forbidden> {
  const denied = guardCompany(session, args.companyId);
  if (denied) return denied;
  const q = args.q?.trim();
  const where = {
    companyId: args.companyId,
    ...(args.includeInactive ? {} : { isActive: true }),
    ...(q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { code: { contains: q, mode: 'insensitive' as const } }] }
      : {}),
  };
  // Экран режет на 500 (сноска «первые 500»), экспорт — на 10 000 (сноска в
  // файле, EXPORT_ROW_LIMIT). `total` — честная цифра для обеих сносок:
  // молчаливое усечение — дефект (§15).
  const [items, total] = await Promise.all([
    prisma.catalogItem.findMany({
      where,
      select: ROW_SELECT,
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      take: args.limit ?? 500,
    }),
    prisma.catalogItem.count({ where }),
  ]);
  return { ok: true, items: items.map(toRow), total };
}

export async function createCatalogItem(
  prisma: PrismaClient,
  session: SessionPayload,
  companyId: string,
  input: CatalogItemInput
): Promise<{ ok: true; id: string } | Forbidden | Validation | DuplicateCode> {
  const denied = guardCompany(session, companyId);
  if (denied) return denied;
  const validated = validateCatalogItemInput(input);
  if (!validated.ok) return validated;
  const d = validated.data;
  try {
    const created = await prisma.catalogItem.create({
      data: {
        companyId,
        name: d.name,
        code: d.code,
        unit: d.unit,
        price: d.price,
        vatRate: d.vatRate,
        vatIncluded: d.vatIncluded,
        directionId: d.directionId,
        description: d.description,
        sortOrder: d.sortOrder,
      },
      select: { id: true },
    });
    await recordAudit(prisma, {
      userId: session.sub,
      action: 'catalog_item_created',
      entity: 'catalog_item',
      entityId: created.id,
      // Ключ `article`, а не `code`: диалог диффа аудита консервативно
      // маскирует любое поле по имени `code` (защита bridge-кодов) — артикул
      // же не секрет и должен быть виден.
      after: { name: d.name, article: d.code, price: d.price, vatRate: d.vatRate },
    });
    return { ok: true, id: created.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'duplicate_code' };
    if (isFkViolation(e)) {
      return { ok: false, error: 'validation', messages: ['Направление не найдено'] };
    }
    throw e;
  }
}

export async function updateCatalogItem(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  input: CatalogItemInput
): Promise<{ ok: true } | Forbidden | NotFound | Validation | DuplicateCode> {
  if (session.role !== 'admin' && session.role !== 'leader') {
    return { ok: false, error: 'forbidden' };
  }
  const existing = await prisma.catalogItem.findUnique({
    where: { id },
    select: { ...ROW_SELECT, companyId: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };
  const denied = guardCompany(session, existing.companyId);
  if (denied) return denied;
  const validated = validateCatalogItemInput(input);
  if (!validated.ok) return validated;
  const d = validated.data;
  try {
    await prisma.catalogItem.update({
      where: { id },
      data: {
        name: d.name,
        code: d.code,
        unit: d.unit,
        price: d.price,
        vatRate: d.vatRate,
        vatIncluded: d.vatIncluded,
        directionId: d.directionId,
        description: d.description,
        sortOrder: d.sortOrder,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'duplicate_code' };
    if (isFkViolation(e)) {
      return { ok: false, error: 'validation', messages: ['Направление не найдено'] };
    }
    throw e;
  }
  // История изменений цены (`У-136`): before/after в аудите — что менялось,
  // видно диффом в разделе «Аудит». Формат `vatRate` в обеих половинах один
  // (4 знака): `Decimal.toString()` обрезал бы нули, и каждая правка
  // показывала бы фантомную смену ставки «0.2 → 0.2000».
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'catalog_item_updated',
    entity: 'catalog_item',
    entityId: id,
    before: {
      name: existing.name,
      article: existing.code,
      price: existing.price.toFixed(2),
      vatRate: existing.vatRate === null ? null : existing.vatRate.toFixed(4),
      vatIncluded: existing.vatIncluded,
      unit: existing.unit,
    },
    after: {
      name: d.name,
      article: d.code,
      price: d.price,
      vatRate: d.vatRate,
      vatIncluded: d.vatIncluded,
      unit: d.unit,
    },
  });
  return { ok: true };
}

export async function setCatalogItemActive(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  active: boolean
): Promise<{ ok: true } | Forbidden | NotFound> {
  if (session.role !== 'admin' && session.role !== 'leader') {
    return { ok: false, error: 'forbidden' };
  }
  const existing = await prisma.catalogItem.findUnique({
    where: { id },
    select: { companyId: true, isActive: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };
  const denied = guardCompany(session, existing.companyId);
  if (denied) return denied;
  if (existing.isActive === active) return { ok: true };
  await prisma.catalogItem.update({ where: { id }, data: { isActive: active } });
  await recordAudit(prisma, {
    userId: session.sub,
    action: active ? 'catalog_item_activated' : 'catalog_item_deactivated',
    entity: 'catalog_item',
    entityId: id,
  });
  return { ok: true };
}

function prismaCode(e: unknown): unknown {
  return typeof e === 'object' && e !== null && 'code' in e ? (e as { code?: unknown }).code : null;
}

function isUniqueViolation(e: unknown): boolean {
  return prismaCode(e) === 'P2002';
}

/** P2003 — битый FK: подделанный `directionId` это ошибка формы, не 500. */
function isFkViolation(e: unknown): boolean {
  return prismaCode(e) === 'P2003';
}
