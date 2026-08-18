/**
 * Этап 6 PR-2 — интеграционный цикл конверсий против живого Postgres:
 * партнёрский лид с организацией → convertLeadToDeal (наследование
 * организации/суммы/менеджера, лид promoted_to_deal + promotedDealId) →
 * winDeal (заказ: partnerId лида, totalAmount, externalId null; сделка
 * won/orderId) → повторные конверсии → lifecycle_violation → org_required
 * для сделки без организации → сосуществование заметок сделки (dealId) и
 * заметок заказа (orderId) в одной таблице DealNote.
 *
 * Запуск: npx vitest run --mode=integration src/__tests__/services.deals.convert.integration.test.ts
 * Префикс данных: deal6pr2-int. Cleanup — beforeAll (хвосты) + afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { convertLeadToDeal, winDeal } from '@/lib/services/deals/convert';
import { addNoteToDeal, listDealNotes } from '@/lib/services/deals/notes';
import type { SessionPayload } from '@/lib/auth/jwt';

const P = 'deal6pr2-int';
let prisma: PrismaClient;
let companyA: string, orgA: string, partnerId: string;
let leaderAId: string, mgrAId: string;
let leadId: string;

const leaderA = (): SessionPayload => ({
  sub: leaderAId,
  role: 'leader',
  companyId: companyA,
});
const mgrA = (): SessionPayload => ({ sub: mgrAId, role: 'manager', companyId: companyA });

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { contains: P } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const companies = await prisma.company.findMany({
    where: { name: { startsWith: P } },
    select: { id: true },
  });
  const companyIds = companies.map((c) => c.id);
  const partners = await prisma.partner.findMany({
    where: { name: { startsWith: P } },
    select: { id: true },
  });
  const partnerIds = partners.map((p) => p.id);

  // Заметки (dealId- и orderId-привязки) — авторы только наши пользователи.
  if (userIds.length) await prisma.dealNote.deleteMany({ where: { authorId: { in: userIds } } });
  if (companyIds.length) {
    await prisma.deal.deleteMany({ where: { companyId: { in: companyIds } } });
  }
  // Лиды раньше заказов: Lead.promotedOrderId — FK на Order.
  await prisma.lead.deleteMany({ where: { clientCompanyName: { startsWith: P } } });
  if (companyIds.length) {
    await prisma.order.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.dealStage.deleteMany({ where: { companyId: { in: companyIds } } });
  }
  if (userIds.length) await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  if (companyIds.length)
    await prisma.organization.deleteMany({ where: { companyId: { in: companyIds } } });
  if (partnerIds.length) await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (companyIds.length) await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
}

beforeAll(async () => {
  prisma = new PrismaClient();
  await cleanup(); // хвосты упавших прошлых прогонов
  companyA = (await prisma.company.create({ data: { name: `${P}-coA` } })).id;
  partnerId = (await prisma.partner.create({ data: { name: `${P}-partner`, commissionRate: 0.1 } }))
    .id;
  orgA = (
    await prisma.organization.create({
      data: { name: `${P}-orgA`, companyId: companyA, partnerId },
    })
  ).id;
  leaderAId = (
    await prisma.user.create({
      data: {
        email: `${P}-leaderA@t.local`,
        name: 'Лидер А',
        role: 'leader',
        companyId: companyA,
      },
    })
  ).id;
  mgrAId = (
    await prisma.user.create({
      data: {
        email: `${P}-mgrA@t.local`,
        name: 'Менеджер А',
        role: 'manager',
        companyId: companyA,
      },
    })
  ).id;
  // Партнёрский лид с организацией — создаём напрямую (вход конверсии).
  leadId = (
    await prisma.lead.create({
      data: {
        partnerId,
        createdByUserId: leaderAId,
        organizationId: orgA,
        clientCompanyName: `${P}-client`,
        clientContactName: 'Контакт',
        subject: `${P} Обучение по ОТ`,
        estimatedAmount: '1200.50',
        status: 'qualified',
        assignedManagerId: mgrAId,
      },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

let dealId: string;
let orderId: string;

describe('конверсии: лид → сделка → заказ', () => {
  it('convertLeadToDeal лидером: сделка наследует организацию/сумму/менеджера лида; лид promoted_to_deal', async () => {
    const res = await convertLeadToDeal(prisma, leaderA(), { leadId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    dealId = res.deal.id;

    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.companyId).toBe(companyA); // companyId организации лида
    expect(deal.organizationId).toBe(orgA);
    expect(deal.leadId).toBe(leadId);
    expect(deal.title).toBe(`${P} Обучение по ОТ`);
    expect(deal.amount?.toFixed(2)).toBe('1200.50');
    expect(deal.managerId).toBe(mgrAId); // assignedManagerId лида приоритетнее sub лидера
    expect(deal.status).toBe('open');

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.status).toBe('promoted_to_deal');
    expect(lead.promotedDealId).toBe(dealId);
    expect(lead.promotedOrderId).toBeNull();

    expect(
      await prisma.auditLog.findFirst({
        where: {
          action: 'lead_promoted_to_deal',
          entity: 'lead',
          entityId: leadId,
          userId: leaderAId,
        },
      })
    ).not.toBeNull();
  });

  it('повторный convertLeadToDeal на promoted-лиде → lifecycle_violation, второй сделки нет', async () => {
    expect(await convertLeadToDeal(prisma, leaderA(), { leadId })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
    expect(await prisma.deal.count({ where: { leadId } })).toBe(1);
  });

  it('winDeal исполнителем: заказ с partnerId лида, totalAmount сделки, externalId null; сделка won/orderId', async () => {
    const res = await winDeal(prisma, mgrA(), { dealId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    orderId = res.order.id;

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.title).toBe(`${P} Обучение по ОТ`);
    expect(order.companyId).toBe(companyA);
    expect(order.organizationId).toBe(orgA);
    expect(order.partnerId).toBe(partnerId); // из лида-источника
    expect(order.managerId).toBe(mgrAId);
    expect(order.totalAmount.toFixed(2)).toBe('1200.50');
    expect(order.externalId).toBeNull(); // локальный заказ — 1С-синк не трогает
    expect(order.executionStatus).toBe('pending');
    expect(order.financialStatus).toBe('not_billed');

    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.status).toBe('won');
    expect(deal.wonAt).not.toBeNull();
    expect(deal.orderId).toBe(orderId);

    expect(
      await prisma.auditLog.findFirst({
        where: {
          action: 'deal_won_order_created',
          entity: 'deal',
          entityId: dealId,
          userId: mgrAId,
        },
      })
    ).not.toBeNull();
  });

  it('повторный winDeal выигранной сделки → lifecycle_violation, второго заказа нет', async () => {
    expect(await winDeal(prisma, mgrA(), { dealId })).toEqual({
      ok: false,
      error: 'lifecycle_violation',
    });
    expect(await prisma.order.count({ where: { companyId: companyA } })).toBe(1);
  });

  it('winDeal сделки без организации → org_required', async () => {
    const bare = await prisma.deal.create({
      data: { companyId: companyA, title: `${P} Без организации`, managerId: mgrAId },
    });
    expect(await winDeal(prisma, mgrA(), { dealId: bare.id })).toEqual({
      ok: false,
      error: 'org_required',
    });
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: bare.id } })).status).toBe('open');
  });
});

describe('заметки: параллельная привязка DealNote (dealId | orderId)', () => {
  it('addNoteToDeal живёт рядом с заказной заметкой; listDealNotes видит только dealId-заметки', async () => {
    const add = await addNoteToDeal(prisma, mgrA(), { dealId, body: `${P} заметка по сделке` });
    expect(add.ok).toBe(true);
    if (!add.ok) return;

    // Существующий поток заметок заказа: orderId напрямую, dealId null.
    const orderNote = await prisma.dealNote.create({
      data: { orderId, authorId: mgrAId, body: `${P} заметка по заказу` },
    });
    expect(orderNote.dealId).toBeNull();

    const list = await listDealNotes(prisma, mgrA(), { dealId });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.rows.map((r) => r.id)).toEqual([add.id]); // заказная заметка не подмешана
    expect(list.rows[0]).toMatchObject({
      body: `${P} заметка по сделке`,
      authorName: 'Менеджер А',
    });
  });

  it('заметка сделки: dealId заполнен, orderId null — параллельная привязка живёт в БД', async () => {
    const row = await prisma.dealNote.findFirstOrThrow({ where: { dealId } });
    expect(row.orderId).toBeNull();
    expect(row.dealId).toBe(dealId);
    expect(row.authorId).toBe(mgrAId);
    // Аудит заметки — entity deal.
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'deal_note_created', entity: 'deal', entityId: dealId, userId: mgrAId },
      })
    ).not.toBeNull();
  });
});
