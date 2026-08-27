import type { CatalogUnit, Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canSeeOrder, getCompanyTeamVisibility, isStaffManagerSide } from '@/lib/auth/managerPolicy';
import { VAT_RATES } from '@/lib/services/admin/catalogItems';
import { computeLineTotals, sumOrderTotals, type OrderTotals } from './lineMath';

/**
 * Этап 5 (`У-139`, `У-140`) — финансовые строки заказа.
 *
 * Отдельно от учебных позиций (`OrderItem` = слушатель × направление): у
 * денег своя жизнь. Цена строки — **снимок** (`Р-13`): правка каталога не
 * трогает уже созданные строки. `Order.totalAmount` пересчитывается из строк,
 * пока сумму не задали вручную; заказы из 1С (`externalId`) — только чтение,
 * их сумма принадлежит синку.
 */

export type OrderLineRow = {
  id: string;
  catalogItemId: string | null;
  title: string;
  quantity: string;
  unit: CatalogUnit;
  unitPrice: string;
  discountPercent: string | null;
  vatRate: string | null;
  vatIncluded: boolean;
  amount: string;
  sortOrder: number;
};

export type OrderLinesView = {
  lines: OrderLineRow[];
  totals: OrderTotals;
  /** Заказ ведётся в 1С — строки и сумма только на чтение. */
  readOnly: boolean;
  totalAmount: string;
  totalAmountIsManual: boolean;
};

export type OrderLineInput = {
  catalogItemId: string | null;
  title: string;
  quantity: string;
  unit: CatalogUnit;
  unitPrice: string;
  discountPercent: string | null;
  vatRate: string | null;
  vatIncluded: boolean;
  sortOrder: number;
};

type Forbidden = { ok: false; error: 'forbidden' };
type NotFound = { ok: false; error: 'not_found' };
type Validation = { ok: false; error: 'validation'; messages: string[] };
type ReadOnly = { ok: false; error: 'order_from_1c' };

const LINE_SELECT = {
  id: true,
  catalogItemId: true,
  title: true,
  quantity: true,
  unit: true,
  unitPrice: true,
  discountPercent: true,
  vatRate: true,
  vatIncluded: true,
  amount: true,
  sortOrder: true,
} satisfies Prisma.OrderLineSelect;

type LinePayload = Prisma.OrderLineGetPayload<{ select: typeof LINE_SELECT }>;

function toRow(l: LinePayload): OrderLineRow {
  return {
    id: l.id,
    catalogItemId: l.catalogItemId,
    title: l.title,
    quantity: l.quantity.toFixed(3),
    unit: l.unit,
    unitPrice: l.unitPrice.toFixed(2),
    discountPercent: l.discountPercent === null ? null : l.discountPercent.toFixed(2),
    vatRate: l.vatRate === null ? null : l.vatRate.toFixed(4),
    vatIncluded: l.vatIncluded,
    amount: l.amount.toFixed(2),
    sortOrder: l.sortOrder,
  };
}

/**
 * Доступ к заказу: строки видит и правит только контур сотрудников ЦО
 * (`У-140` — «редактор строк заказа у сотрудников ЦО»), с обычным
 * менеджерским скоупом. Клиент и партнёр сюда не ходят.
 */
async function loadOrder(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<
  | { ok: true; order: { id: string; externalId: string | null; totalAmount: Prisma.Decimal; totalAmountIsManual: boolean } }
  | Forbidden
  | NotFound
> {
  if (session.role !== 'admin' && !isStaffManagerSide(session)) {
    return { ok: false, error: 'forbidden' };
  }
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      externalId: true,
      totalAmount: true,
      totalAmountIsManual: true,
      companyId: true,
      managerId: true,
      organizationId: true,
      partnerId: true,
    },
  });
  if (!order) return { ok: false, error: 'not_found' };

  if (session.role !== 'admin') {
    // Менеджерский скоуп mode-aware (C8): режим команды читается свежим.
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId ?? null);
    if (!canSeeOrder(session, order, teamMode)) return { ok: false, error: 'forbidden' };
  }
  return {
    ok: true,
    order: {
      id: order.id,
      externalId: order.externalId,
      totalAmount: order.totalAmount,
      totalAmountIsManual: order.totalAmountIsManual,
    },
  };
}

export async function listOrderLines(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<{ ok: true; view: OrderLinesView } | Forbidden | NotFound> {
  const loaded = await loadOrder(prisma, session, orderId);
  if (!loaded.ok) return loaded;
  const rows = await prisma.orderLine.findMany({
    where: { orderId },
    select: LINE_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const lines = rows.map(toRow);
  return {
    ok: true,
    view: {
      lines,
      totals: sumOrderTotals(lines),
      readOnly: loaded.order.externalId !== null,
      totalAmount: loaded.order.totalAmount.toFixed(2),
      totalAmountIsManual: loaded.order.totalAmountIsManual,
    },
  };
}

function validateLine(input: OrderLineInput): { ok: true } | Validation {
  const messages: string[] = [];
  if (!input.title.trim() || input.title.trim().length > 300) {
    messages.push('Наименование: от 1 до 300 символов');
  }
  const qtyRaw = input.quantity.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(qtyRaw) || Number(qtyRaw) <= 0) {
    messages.push('Количество: положительное число, максимум три знака после запятой');
  } else if (Number(qtyRaw) > 999_999) {
    messages.push('Количество: не больше 999 999');
  }
  const priceRaw = input.unitPrice.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(priceRaw)) {
    messages.push('Цена: неотрицательное число, максимум две цифры после запятой');
  } else if (Number(priceRaw) > 999_999_999.99) {
    // Колонка `Decimal(14,2)`: без своей границы перебор улетел бы в 500
    // вместо русского объяснения (§15).
    messages.push('Цена: не больше 999 999 999,99');
  }
  if (input.discountPercent !== null && input.discountPercent.trim() !== '') {
    const raw = input.discountPercent.replace(/\s/g, '').replace(',', '.');
    const disc = Number(raw);
    // Два знака — не придирка: колонка `Decimal(5,2)`, и третий знак молча
    // округлялся бы в базе, разводя строку в таблице с суммой заказа.
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(disc) || disc > 100) {
      messages.push('Скидка: от 0 до 100 процентов, максимум два знака после запятой');
    }
  }
  if (input.vatRate !== null) {
    const rate = Number(input.vatRate);
    // Тот же закрытый список, что у каталога и компании: иначе на экране
    // «12%», а в расчёте 12,35% — расхождение, которое никто не заметит.
    if (!VAT_RATES.includes(rate as (typeof VAT_RATES)[number])) {
      messages.push('Ставка НДС: 0%, 5%, 7%, 10%, 20% или «не облагается»');
    }
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 100_000) {
    messages.push('Порядок: целое число от 0 до 100000');
  }
  return messages.length ? { ok: false, error: 'validation', messages } : { ok: true };
}

function normalized(input: OrderLineInput) {
  const quantity = input.quantity.replace(/\s/g, '').replace(',', '.');
  const unitPrice = input.unitPrice.replace(/\s/g, '').replace(',', '.');
  const discountPercent =
    input.discountPercent === null ? null : input.discountPercent.replace(',', '.');
  const totals = computeLineTotals({
    quantity,
    unitPrice,
    discountPercent,
    vatRate: input.vatRate,
    vatIncluded: input.vatIncluded,
  });
  return {
    catalogItemId: input.catalogItemId,
    title: input.title.trim(),
    quantity: Number(quantity).toFixed(3),
    unit: input.unit,
    unitPrice: Number(unitPrice).toFixed(2),
    discountPercent: discountPercent === null ? null : Number(discountPercent).toFixed(2),
    vatRate: input.vatRate === null ? null : Number(input.vatRate).toFixed(4),
    vatIncluded: input.vatIncluded,
    // Снимок суммы (`Р-13`): дальше он не пересчитывается сам по себе.
    amount: totals.amount,
    sortOrder: input.sortOrder,
  };
}

/**
 * Пересчёт `Order.totalAmount` из строк. Не трогает заказ, если сумму задали
 * вручную (`У-140`) — иначе ручная правка молча откатывалась бы следующим
 * изменением строки.
 */
async function syncOrderTotal(
  prisma: PrismaClient,
  orderId: string,
  opts: { force?: boolean; hadLines?: boolean } = {}
): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { totalAmountIsManual: true },
  });
  if (!order) return;
  const rows = await prisma.orderLine.findMany({ where: { orderId }, select: LINE_SELECT });
  // Строк не осталось, а они были — это «состав опустел». Такой случай
  // обнуляет сумму и СНИМАЕТ пометку «вручную» даже поверх ручной правки:
  // иначе заказ застревал в состоянии «ручная сумма без строк», из которого
  // нет выхода (ручную сумму заново поставить нельзя — строк нет; кнопка
  // «Пересчитать» ничего не меняла и врала об успехе). Ревью PR-4.
  if (rows.length === 0 && opts.hadLines === true) {
    await prisma.order.update({
      where: { id: orderId },
      data: { totalAmount: '0.00', totalAmountIsManual: false },
    });
    return;
  }
  if (order.totalAmountIsManual && opts.force !== true) return;
  if (rows.length === 0) {
    // Строк не было никогда — заказ живёт по-старому: сумма-снимок из
    // сделки или лида (`У-140`), трогать её нечем и незачем.
    return;
  }
  const totals = sumOrderTotals(rows.map(toRow));
  await prisma.order.update({
    where: { id: orderId },
    data: { totalAmount: totals.gross, totalAmountIsManual: false },
  });
}

/**
 * Ссылка на каталог обязана вести в каталог КОМПАНИИ ЗАКАЗА: иначе подделанный
 * `catalogItemId` привязал бы строку к прайсу чужой компании, и этап 6 напечатал
 * бы в документе чужую услугу (ревью PR-4).
 */
async function checkCatalogItem(
  prisma: PrismaClient,
  orderId: string,
  catalogItemId: string | null
): Promise<Validation | null> {
  if (catalogItemId === null) return null;
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { companyId: true } });
  const item = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    select: { companyId: true },
  });
  if (!item || item.companyId !== order?.companyId) {
    return { ok: false, error: 'validation', messages: ['Услуга не найдена в каталоге компании'] };
  }
  return null;
}

export async function addOrderLine(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string,
  input: OrderLineInput
): Promise<{ ok: true; id: string } | Forbidden | NotFound | Validation | ReadOnly> {
  const loaded = await loadOrder(prisma, session, orderId);
  if (!loaded.ok) return loaded;
  if (loaded.order.externalId !== null) return { ok: false, error: 'order_from_1c' };
  const valid = validateLine(input);
  if (!valid.ok) return valid;
  const badCatalog = await checkCatalogItem(prisma, orderId, input.catalogItemId);
  if (badCatalog) return badCatalog;

  const data = normalized(input);
  const created = await prisma.orderLine.create({
    data: { orderId, ...data },
    select: { id: true },
  });
  await syncOrderTotal(prisma, orderId);
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_line_added',
    entity: 'order',
    entityId: orderId,
    after: { title: data.title, quantity: data.quantity, amount: data.amount },
  });
  return { ok: true, id: created.id };
}

export async function updateOrderLine(
  prisma: PrismaClient,
  session: SessionPayload,
  lineId: string,
  input: OrderLineInput
): Promise<{ ok: true } | Forbidden | NotFound | Validation | ReadOnly> {
  const existing = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: { orderId: true, title: true, amount: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };
  const loaded = await loadOrder(prisma, session, existing.orderId);
  if (!loaded.ok) return loaded;
  if (loaded.order.externalId !== null) return { ok: false, error: 'order_from_1c' };
  const valid = validateLine(input);
  if (!valid.ok) return valid;
  const badCatalog = await checkCatalogItem(prisma, existing.orderId, input.catalogItemId);
  if (badCatalog) return badCatalog;

  const data = normalized(input);
  await prisma.orderLine.update({ where: { id: lineId }, data });
  await syncOrderTotal(prisma, existing.orderId);
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_line_updated',
    entity: 'order',
    entityId: existing.orderId,
    before: { title: existing.title, amount: existing.amount.toFixed(2) },
    after: { title: data.title, amount: data.amount },
  });
  return { ok: true };
}

export async function removeOrderLine(
  prisma: PrismaClient,
  session: SessionPayload,
  lineId: string
): Promise<{ ok: true } | Forbidden | NotFound | ReadOnly> {
  const existing = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: { orderId: true, title: true, amount: true },
  });
  if (!existing) return { ok: false, error: 'not_found' };
  const loaded = await loadOrder(prisma, session, existing.orderId);
  if (!loaded.ok) return loaded;
  if (loaded.order.externalId !== null) return { ok: false, error: 'order_from_1c' };

  await prisma.orderLine.delete({ where: { id: lineId } });
  // Строка была — значит пустой список после удаления это «строк больше нет»,
  // а не «строк никогда не было».
  await syncOrderTotal(prisma, existing.orderId, { hadLines: true });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_line_removed',
    entity: 'order',
    entityId: existing.orderId,
    before: { title: existing.title, amount: existing.amount.toFixed(2) },
  });
  return { ok: true };
}

/**
 * Ручная сумма заказа (`У-140`): человек имеет право поставить своё число,
 * но это фиксируется флагом, плашкой и аудитом — иначе расхождение со
 * строками выглядело бы ошибкой расчёта.
 */
export async function setOrderTotalManually(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string,
  rawAmount: string
): Promise<{ ok: true } | Forbidden | NotFound | Validation | ReadOnly> {
  const loaded = await loadOrder(prisma, session, orderId);
  if (!loaded.ok) return loaded;
  if (loaded.order.externalId !== null) return { ok: false, error: 'order_from_1c' };
  const cleaned = rawAmount.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: 'validation', messages: ['Сумма: неотрицательное число'] };
  }
  // Спека §3.3: ручная правка суммы появляется ТОЛЬКО вместе со строками.
  // У заказа без строк сумма — снимок из сделки или лида, и трогать её
  // руками нельзя: инвариант `invariants.price-snapshot` держится именно
  // на этом.
  const linesCount = await prisma.orderLine.count({ where: { orderId } });
  if (linesCount === 0) {
    return {
      ok: false,
      error: 'validation',
      messages: ['У заказа нет строк — сумма считается по сделке и правится вместе со строками.'],
    };
  }
  const amount = Number(cleaned).toFixed(2);
  await prisma.order.update({
    where: { id: orderId },
    data: { totalAmount: amount, totalAmountIsManual: true },
  });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_total_set_manually',
    entity: 'order',
    entityId: orderId,
    before: { totalAmount: loaded.order.totalAmount.toFixed(2) },
    after: { totalAmount: amount },
  });
  return { ok: true };
}

/** Вернуть сумму к расчётной по строкам (снимает флаг «вручную»). */
export async function recalcOrderTotal(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<{ ok: true } | Forbidden | NotFound | ReadOnly> {
  const loaded = await loadOrder(prisma, session, orderId);
  if (!loaded.ok) return loaded;
  if (loaded.order.externalId !== null) return { ok: false, error: 'order_from_1c' };
  // `hadLines` — потому что кнопку показывают только при ручной сумме, а её
  // можно было поставить лишь при наличии строк: пустой состав здесь значит
  // «строки удалили», и пересчёт обязан дать ноль, а не промолчать.
  await syncOrderTotal(prisma, orderId, { force: true, hadLines: true });
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_total_recalculated',
    entity: 'order',
    entityId: orderId,
  });
  return { ok: true };
}

export type BuildFromItemsResult = {
  ok: true;
  created: number;
  /** Направления без цены в каталоге — строка создана с нулём (`У-139`). */
  withoutPrice: string[];
};

/**
 * «Собрать строки из позиций» (`У-139`): группирует `OrderItem` по
 * направлению и создаёт строки «<направление> × N чел.».
 *
 * Цена берётся из элемента каталога, связанного с направлением; направления
 * без такого элемента дают строку с нулём И попадают в предупреждение —
 * молча пропустить их нельзя (§15).
 */
export async function buildLinesFromItems(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<BuildFromItemsResult | Forbidden | NotFound | Validation | ReadOnly> {
  const loaded = await loadOrder(prisma, session, orderId);
  if (!loaded.ok) return loaded;
  if (loaded.order.externalId !== null) return { ok: false, error: 'order_from_1c' };

  // Повторное нажатие не должно удваивать строки и сумму (ревью PR-4):
  // сборка — операция «собрать с нуля», а не «дописать».
  const existingLines = await prisma.orderLine.count({ where: { orderId } });
  if (existingLines > 0) {
    return {
      ok: false,
      error: 'validation',
      messages: [
        'В заказе уже есть строки. Удалите их, если хотите собрать состав из позиций заново.',
      ],
    };
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { companyId: true },
  });
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { directionId: true, direction: { select: { id: true, name: true } } },
  });
  if (items.length === 0) {
    return {
      ok: false,
      error: 'validation',
      messages: ['В заказе нет позиций — сначала добавьте слушателей.'],
    };
  }

  const byDirection = new Map<string, { name: string; count: number }>();
  for (const item of items) {
    const key = item.directionId;
    const prev = byDirection.get(key);
    byDirection.set(key, {
      name: item.direction?.name ?? 'Направление',
      count: (prev?.count ?? 0) + 1,
    });
  }

  const catalog = await prisma.catalogItem.findMany({
    where: {
      companyId: order?.companyId ?? '__none__',
      isActive: true,
      directionId: { in: [...byDirection.keys()] },
    },
    select: { id: true, directionId: true, unit: true, price: true, vatRate: true, vatIncluded: true },
    // Детерминированный порядок: если направлению соответствует несколько
    // позиций каталога, берём первую по sortOrder — иначе цена в заказе
    // зависела бы от порядка выдачи базы (ревью PR-4).
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const priceByDirection = new Map<string, (typeof catalog)[number]>();
  for (const c of catalog) {
    if (c.directionId && !priceByDirection.has(c.directionId)) priceByDirection.set(c.directionId, c);
  }

  const withoutPrice: string[] = [];
  let sortOrder = 0;
  let created = 0;
  for (const [directionId, group] of byDirection) {
    const price = priceByDirection.get(directionId);
    if (!price) withoutPrice.push(group.name);
    const input: OrderLineInput = {
      catalogItemId: price?.id ?? null,
      title: `${group.name} × ${group.count} чел.`,
      quantity: String(group.count),
      unit: price?.unit ?? 'person',
      unitPrice: price ? price.price.toFixed(2) : '0',
      discountPercent: null,
      vatRate: price?.vatRate ? price.vatRate.toFixed(4) : null,
      vatIncluded: price?.vatIncluded ?? true,
      sortOrder: sortOrder++,
    };
    await prisma.orderLine.create({ data: { orderId, ...normalized(input) } });
    created += 1;
  }

  await syncOrderTotal(prisma, orderId);
  await recordAudit(prisma, {
    userId: session.sub,
    action: 'order_lines_built_from_items',
    entity: 'order',
    entityId: orderId,
    after: { created, withoutPrice: withoutPrice.length },
  });
  return { ok: true, created, withoutPrice };
}
