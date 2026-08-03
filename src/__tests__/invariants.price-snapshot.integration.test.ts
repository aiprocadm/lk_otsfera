/**
 * Инвариант-тесты «снимок суммы заявки» — «исполняемое ТЗ» (фаза 6).
 *
 * РЕЗУЛЬТАТ РАЗВЕДКИ (важно): «прайса» / справочных цен в системе НЕТ:
 *   — справочник направлений TrainingDirection не содержит поля цены
 *     (prisma/schema.prisma) — переименование/деактивация направления не
 *     может повлиять на суммы по построению;
 *   — OrderItem.amount — nullable «задел попозиционного счёта» (комментарий в
 *     схеме, этап 8 §9-3): ни один сервис его не заполняет, позиции заявки
 *     локальных цен не несут;
 *   — сумма заявки Order.totalAmount фиксируется ОДИН раз в момент создания
 *     копированием из источника: сделка (services/deals/convert.ts, winDeal:
 *     totalAmount = deal.amount), лид (services/manager/leadLifecycle.ts,
 *     promoteLead: totalAmount = lead.estimatedAmount) — и локально никогда
 *     не пересчитывается;
 *   — у 1С-заказов totalAmount принадлежит 1С (ownedBy1C в
 *     services/oneCSync/writers.ts) и обновляется только синком по externalId;
 *     локальные заказы (externalId = null) синк не трогает — комментарий у
 *     promoteLead и у Deal.orderId в схеме.
 *
 * Инвариант, который реально держится и который пришпиливают эти тесты:
 * «сумма существующей заявки не меняется задним числом» — изменение суммы
 * сделки/оценки лида ПОСЛЕ создания заявки не отражается на заявке (снимок,
 * а не вычисление), а updateDeal вдобавок отвергает правку завершённой
 * (won) сделки. Разворот любого из решений роняет тесты.
 *
 * Integration: winDeal/promoteLead/addOrderItem ходят в живой Postgres
 * ($transaction + справочник статусов §10 ТЗ v0.5).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { winDeal } from '@/lib/services/deals/convert';
import { updateDeal } from '@/lib/services/deals/crud';
import { promoteLead } from '@/lib/services/manager/leadLifecycle';
import { addOrderItem } from '@/lib/services/training/orderItems';

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
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
  await prisma.deal.deleteMany({ where: { id: { in: dealIds } } }).catch(() => {});
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {});
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

describe('Снимок суммы заявки на момент создания не меняется задним числом', () => {
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

  it('позиции заявки не несут локальной цены: добавление позиции не пересчитывает сумму заявки, у позиции нет суммы', async () => {
    // Заявка из первого теста (managerId = session.sub → менеджер её видит).
    const orderId = orderIds[0];
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

    const item = await prisma.orderItem.findUniqueOrThrow({
      where: { id: added.item.id },
      select: { amount: true },
    });
    // OrderItem.amount — незаполняемый задел: локальной цены у позиции нет.
    expect(item.amount).toBeNull();
    // Сумма заявки не пересчитана добавлением позиции.
    expect(await orderTotal(orderId)).toBe('10000.50');
  });
});
