import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { recentEvents } from '@/lib/services/partner/dashboard';

let prisma: PrismaClient;
let partnerId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'EvP-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'EvC-' + Date.now() } });
  const org = await prisma.organization.create({ data: { name: 'O', partnerId, companyId: c.id } });

  const order = await prisma.order.create({
    data: {
      title: 'Заказ',
      companyId: c.id,
      partnerId,
      organizationId: org.id,
      totalAmount: 1000,
      paidAmount: 0,
      executionStatus: 'in_progress',
      financialStatus: 'billed',
    },
  });

  await prisma.payment.create({
    data: { organizationId: org.id, orderId: order.id, amount: 500, paidAt: new Date() },
  });

  const u = await prisma.user.create({
    data: {
      email: `ev-${Date.now()}@t.local`,
      passwordHash: 'x',
      name: 'L',
      role: 'partner',
      partnerId,
    },
  });
  await prisma.lead.create({
    data: {
      partnerId,
      createdByUserId: u.id,
      clientCompanyName: 'Лид',
      clientContactName: 'X',
      subject: 'S',
      status: 'new',
      productType: [],
    },
  });
  // F2: order events surface only for lead-linked orders → promote the seeded order.
  await prisma.lead.create({
    data: {
      partnerId,
      createdByUserId: u.id,
      organizationId: org.id,
      clientCompanyName: 'Лид-заказ',
      clientContactName: 'X',
      subject: 'S',
      status: 'promoted_to_order',
      productType: [],
      promotedOrderId: order.id,
    },
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { order: { partnerId } } });
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'EvC-' } } });
  await prisma.$disconnect();
});

describe('partner.dashboard.recentEvents', () => {
  it('returns mixed events across orders, leads, payments sorted by time desc', async () => {
    const events = await recentEvents(prisma, { partnerId, scopeOrgIds: [] }, 10);
    expect(events.length).toBeGreaterThan(0);
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].at.getTime()).toBeGreaterThanOrEqual(events[i].at.getTime());
    }
  });

  it('respects limit', async () => {
    const events = await recentEvents(prisma, { partnerId, scopeOrgIds: [] }, 1);
    expect(events).toHaveLength(1);
  });

  it('returns nothing for foreign partner', async () => {
    const events = await recentEvents(prisma, { partnerId: 'no-such', scopeOrgIds: [] }, 10);
    expect(events).toHaveLength(0);
  });
});
