/**
 * Инвариант-тесты «снимок цены» — «исполняемое ТЗ».
 *
 * ПЕРЕПИСАНО ЭТАПОМ 5 (`У-139`, `У-140`, решение `Р-13`). Раньше в системе не
 * было ни каталога цен, ни строк заказа, и инвариант формулировался
 * единственно возможным способом: «сумма заявки — снимок источника (сделка /
 * оценка лида) и не пересчитывается никогда». Теперь у заказа есть финансовые
 * строки (`OrderLine`), поэтому инвариант РАСЩЕПИЛСЯ на два, и оба живут здесь:
 *
 *   1. **Снимок живёт в строке.** `OrderLine.unitPrice/vatRate/amount` —
 *      копия каталога на момент добавления. Правка `CatalogItem` (цена
 *      выросла, ставка сменилась) НЕ трогает уже созданные строки: иначе
 *      выставленный счёт менялся бы задним числом. Проверяем прямой пробой —
 *      создать строку из элемента каталога, изменить элемент, перечитать
 *      строку.
 *   2. **Сумма заказа выводится ИЗ строк**, пока её не задали вручную
 *      (`totalAmountIsManual`). Это новое поведение, и оно НЕ отменяет
 *      прежнюю формулировку, а сужает её область.
 *
 * Прежний инвариант сохраняется дословно для двух случаев, где строк нет:
 *   — заказ **без строк** (пришёл из сделки или лида): сумма-снимок остаётся
 *     как была, добавление учебной позиции её не пересчитывает, изменение
 *     исходной сделки/лида задним числом на неё не влияет;
 *   — заказ **из 1С** (`externalId`): сумма и строки принадлежат синку,
 *     локальный редактор к ним не допускается вовсе.
 *
 * Разворот любого из решений роняет тесты.
 *
 * Integration: winDeal/promoteLead/addOrderItem и сервис строк ходят в живой
 * Postgres ($transaction + справочник статусов §10 ТЗ v0.5).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { winDeal } from '@/lib/services/deals/convert';
import { updateDeal } from '@/lib/services/deals/crud';
import { promoteLead } from '@/lib/services/manager/leadLifecycle';
import { addOrderItem } from '@/lib/services/training/orderItems';
import {
  addOrderLine,
  listOrderLines,
  recalcOrderTotal,
  setOrderTotalManually,
  type OrderLineInput,
} from '@/lib/services/orders/orderLines';

let prisma: PrismaClient;
const STAMP = Date.now();

let companyId: string;
let orgId: string;
let managerId: string;
let session: SessionPayload;

const orderIds: string[] = [];
const dealIds: string[] = [];
const leadIds: string[] = [];

beforeAll(async () => {
  prisma = new PrismaClient();
  companyId = (await prisma.company.create({ data: { name: `priceSnap-co-${STAMP}` } })).id;
  orgId = (
    await prisma.organization.create({ data: { name: `priceSnap-org-${STAMP}`, companyId } })
  ).id;
  managerId = (
    await prisma.user.create({
      data: {
        email: `priceSnap-mgr-${STAMP}@t.local`,
        name: 'Менеджер снимка цен',
        role: 'manager',
        companyId,
      },
    })
  ).id;
  session = { sub: managerId, role: 'manager', companyId };
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: managerId } }).catch(() => {});
  // Строки — раньше элементов каталога: связь `OrderLine → CatalogItem` стоит
  // на Restrict (использованный элемент не удаляется физически, `У-136`).
  await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
  await prisma.deal.deleteMany({ where: { id: { in: dealIds } } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {});
  await prisma.catalogItem.deleteMany({ where: { companyId } }).catch(() => {});
  await prisma.student.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
  await prisma.trainingDirection
    .deleteMany({ where: { name: `priceSnap-dir-${STAMP}` } })
    .catch(() => {});
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: managerId } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: companyId } }).catch(() => {});
  await prisma.$disconnect();
});

async function orderTotal(orderId: string): Promise<string> {
  const o = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { totalAmount: true },
  });
  return o.totalAmount.toFixed(2);
}

async function orderIsManual(orderId: string): Promise<boolean> {
  const o = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { totalAmountIsManual: true },
  });
  return o.totalAmountIsManual;
}

async function makeOrder(title: string, over: { externalId?: string; totalAmount?: string } = {}) {
  const order = await prisma.order.create({
    data: {
      companyId,
      organizationId: orgId,
      managerId,
      title,
      totalAmount: over.totalAmount ?? '0',
      ...(over.externalId !== undefined ? { externalId: over.externalId } : {}),
    },
    select: { id: true },
  });
  orderIds.push(order.id);
  return order.id;
}

const lineInput = (over: Partial<OrderLineInput> = {}): OrderLineInput => ({
  catalogItemId: null,
  title: 'Строка заказа',
  quantity: '1',
  unit: 'person',
  unitPrice: '1000',
  discountPercent: null,
  vatRate: null,
  vatIncluded: true,
  sortOrder: 0,
  ...over,
});

async function linesOf(orderId: string) {
  const res = await listOrderLines(prisma, session, orderId);
  if (!res.ok) throw new Error(`listOrderLines failed: ${res.error}`);
  return res.view;
}

// =============================================================== Р-13 =======
describe('Р-13: цена и ставка — снимок в строке заказа, каталог задним числом её не меняет', () => {
  it('правка элемента каталога не трогает уже созданную строку: ни цену, ни ставку, ни сумму', async () => {
    const item = await prisma.catalogItem.create({
      data: {
        companyId,
        name: `priceSnap-item-${STAMP}`,
        code: `priceSnap-code-${STAMP}`,
        unit: 'person',
        price: '6000.00',
        vatRate: '0.2000',
        vatIncluded: true,
      },
    });
    const orderId = await makeOrder(`priceSnap-order-catalog-${STAMP}`);

    const added = await addOrderLine(
      prisma,
      session,
      orderId,
      lineInput({
        catalogItemId: item.id,
        title: item.name,
        quantity: '2',
        unitPrice: item.price.toFixed(2),
        vatRate: '0.20',
        vatIncluded: true,
      })
    );
    if (!added.ok) throw new Error(`addOrderLine failed: ${added.error}`);

    // Сумма заказа выведена из строк: 2 × 6000, НДС внутри.
    expect(await orderTotal(orderId)).toBe('12000.00');

    // Каталог подорожал и сменил ставку УЖЕ ПОСЛЕ создания строки.
    await prisma.catalogItem.update({
      where: { id: item.id },
      data: { price: '99999.00', vatRate: '0.1000', vatIncluded: false },
    });

    const view = await linesOf(orderId);
    const line = view.lines[0]!;
    expect(line.catalogItemId).toBe(item.id); // связь с каталогом есть…
    expect(line.unitPrice).toBe('6000.00'); // …но цена своя, снимком
    expect(line.vatRate).toBe('0.2000');
    expect(line.vatIncluded).toBe(true);
    expect(line.amount).toBe('12000.00');
    expect(view.totals).toEqual({ net: '10000.00', vat: '2000.00', gross: '12000.00' });
    // И сумма заказа тоже не поехала вслед за каталогом.
    expect(await orderTotal(orderId)).toBe('12000.00');
  });

  it('сумма заказа выводится из строк, ручная сумма её фиксирует, «пересчитать» возвращает расчётную', async () => {
    const orderId = await makeOrder(`priceSnap-order-lines-${STAMP}`);

    const first = await addOrderLine(prisma, session, orderId, lineInput({ unitPrice: '1000' }));
    if (!first.ok) throw new Error(`addOrderLine failed: ${first.error}`);
    expect(await orderTotal(orderId)).toBe('1000.00');

    const second = await addOrderLine(
      prisma,
      session,
      orderId,
      lineInput({ unitPrice: '500', sortOrder: 1 })
    );
    if (!second.ok) throw new Error(`addOrderLine failed: ${second.error}`);
    expect(await orderTotal(orderId)).toBe('1500.00');
    expect(await orderIsManual(orderId)).toBe(false);

    // Человек поставил свою сумму — она помечается как ручная…
    expect(await setOrderTotalManually(prisma, session, orderId, '2 000,50')).toEqual({ ok: true });
    expect(await orderTotal(orderId)).toBe('2000.50');
    expect(await orderIsManual(orderId)).toBe(true);

    // …и следующая строка её НЕ откатывает (иначе правка молча терялась бы).
    const third = await addOrderLine(
      prisma,
      session,
      orderId,
      lineInput({ unitPrice: '250', sortOrder: 2 })
    );
    if (!third.ok) throw new Error(`addOrderLine failed: ${third.error}`);
    expect(await orderTotal(orderId)).toBe('2000.50');

    // Явное «пересчитать по строкам» — единственный способ вернуть расчётную.
    expect(await recalcOrderTotal(prisma, session, orderId)).toEqual({ ok: true });
    expect(await orderTotal(orderId)).toBe('1750.00');
    expect(await orderIsManual(orderId)).toBe(false);
  });
});

// ============================================ прежняя формулировка ==========
describe('Заказ БЕЗ строк: сумма-снимок на момент создания не меняется задним числом', () => {
  it('выигрыш сделки фиксирует сумму заявки равной сумме сделки на момент конвертации; последующие изменения сделки на заявку не влияют', async () => {
    const deal = await prisma.deal.create({
      data: {
        companyId,
        organizationId: orgId,
        managerId,
        title: `priceSnap-deal-${STAMP}`,
        amount: '10000.50',
      },
    });
    dealIds.push(deal.id);

    const won = await winDeal(prisma, session, { dealId: deal.id });
    if (!won.ok) throw new Error(`winDeal failed: ${won.error}`);
    orderIds.push(won.order.id);
    // Снимок: сумма заявки = сумма сделки на момент выигрыша.
    expect(won.order.totalAmount.toFixed(2)).toBe('10000.50');
    expect(await orderTotal(won.order.id)).toBe('10000.50');

    // Попытка изменить сумму через сервис: завершённую (won) сделку править нельзя.
    const upd = await updateDeal(prisma, session, {
      dealId: deal.id,
      title: deal.title,
      amount: '99999.99',
    });
    expect(upd).toMatchObject({ ok: false, error: 'validation' });
    expect(await orderTotal(won.order.id)).toBe('10000.50');

    // Даже прямое изменение суммы сделки в БД (обход сервиса / будущий код)
    // не отражается на заявке: сумма СКОПИРОВАНА при создании, а не вычисляется.
    await prisma.deal.update({ where: { id: deal.id }, data: { amount: '99999.99' } });
    expect(await orderTotal(won.order.id)).toBe('10000.50');

    // Строк у этой заявки нет — значит выводить сумму не из чего, и снимок
    // остаётся единственным источником правды.
    const view = await linesOf(won.order.id);
    expect(view.lines).toEqual([]);
    expect(view.totalAmount).toBe('10000.50');
    expect(view.totalAmountIsManual).toBe(false);
  });

  it('изменение оценки лида после превращения лида в заявку не меняет сумму заявки', async () => {
    const lead = await prisma.lead.create({
      data: {
        createdByUserId: managerId,
        organizationId: orgId,
        clientCompanyName: `priceSnap-client-${STAMP}`,
        clientContactName: 'Контакт',
        subject: `priceSnap-lead-${STAMP}`,
        estimatedAmount: '5000.00',
      },
    });
    leadIds.push(lead.id);

    const promoted = await promoteLead(prisma, { leadId: lead.id, managerId });
    if (!promoted.ok) throw new Error(`promoteLead failed: ${promoted.error}`);
    orderIds.push(promoted.order.id);
    // Снимок: сумма заявки = оценка лида на момент конвертации.
    expect(promoted.order.totalAmount.toFixed(2)).toBe('5000.00');

    await prisma.lead.update({ where: { id: lead.id }, data: { estimatedAmount: '7777.77' } });
    expect(await orderTotal(promoted.order.id)).toBe('5000.00');
  });

  it('учебные позиции не несут цены: добавление позиции не пересчитывает сумму заявки', async () => {
    // СВОЯ заявка, а не «первая в массиве». Прежде тест брал `orderIds[0]` и
    // ждал 10000.50 — сумму заявки из теста про выигрыш сделки. Этап 5 добавил
    // тесты ВЫШЕ, первой стала другая заявка (12000.00), и тест покраснел,
    // хотя проверяемый инвариант не менялся: порядок тестов в файле не должен
    // решать, что именно проверяется.
    const orderId = await makeOrder(`priceSnap-order-items-${STAMP}`, {
      totalAmount: '10000.50',
    });
    const student = await prisma.student.create({
      data: {
        organizationId: orgId,
        email: `priceSnap-stu-${STAMP}@t.local`,
        name: 'Слушатель Снимков',
      },
    });
    const direction = await prisma.trainingDirection.create({
      data: { name: `priceSnap-dir-${STAMP}` },
    });

    const added = await addOrderItem(prisma, session, {
      orderId,
      studentId: student.id,
      directionId: direction.id,
    });
    if (!added.ok) throw new Error(`addOrderItem failed: ${added.error}`);

    // `У-139` (PR-5): колонки `OrderItem.amount` больше нет — деньги живут в
    // `OrderLine` (`Р-13`), а учебная позиция осталась «слушатель ×
    // направление». Проверяем это по схеме, а не по значению поля.
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'OrderItem'
    `;
    expect(columns.map((c) => c.column_name)).not.toContain('amount');
    // Сумма заявки не пересчитана добавлением позиции.
    expect(await orderTotal(orderId)).toBe('10000.50');
    expect((await linesOf(orderId)).lines).toEqual([]);
  });
});

// =================================================== заказ из 1С ============
describe('Заказ из 1С: строки и сумма принадлежат синку, локальный редактор к ним не допускается', () => {
  it('добавить строку и задать сумму вручную нельзя; сумма 1С остаётся нетронутой', async () => {
    const orderId = await makeOrder(`priceSnap-order-1c-${STAMP}`, {
      externalId: `priceSnap-1c-${STAMP}`,
      totalAmount: '55555.55',
    });

    expect(await addOrderLine(prisma, session, orderId, lineInput())).toEqual({
      ok: false,
      error: 'order_from_1c',
    });
    expect(await setOrderTotalManually(prisma, session, orderId, '1')).toEqual({
      ok: false,
      error: 'order_from_1c',
    });
    expect(await recalcOrderTotal(prisma, session, orderId)).toEqual({
      ok: false,
      error: 'order_from_1c',
    });

    expect(await orderTotal(orderId)).toBe('55555.55');
    expect(await prisma.orderLine.count({ where: { orderId } })).toBe(0);

    // Читать — можно, но экран обязан знать, что правка запрещена.
    const view = await linesOf(orderId);
    expect(view.readOnly).toBe(true);
    expect(view.totalAmount).toBe('55555.55');
  });
});
