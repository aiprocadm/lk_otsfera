import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { attention } from '@/lib/services/partner/dashboard';

let prisma: PrismaClient;
let partnerId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'AttP-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'AttC-' + Date.now() } });
  const org = await prisma.organization.create({ data: { name: 'O', partnerId, companyId: c.id } });

  const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 3600 * 1000);
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);

  const u = await prisma.user.create({
    data: {
      email: `att-${Date.now()}@t.local`,
      passwordHash: 'x',
      name: 'L',
      role: 'partner',
      partnerId,
    },
  });

  // F2: partner sees orders only via leads → link each order to a promoting lead.
  const orders = [
    {
      title: 'Зависшая 20 дней',
      totalAmount: 50000,
      paidAmount: 0,
      executionStatus: 'in_progress' as const,
      financialStatus: 'billed' as const,
      updatedAt: twentyDaysAgo,
      createdAt: twentyDaysAgo,
    },
    {
      title: 'Свежая',
      totalAmount: 50000,
      paidAmount: 0,
      executionStatus: 'in_progress' as const,
      financialStatus: 'billed' as const,
      updatedAt: tenDaysAgo,
      createdAt: tenDaysAgo,
    },
    {
      title: 'Просроченный счёт',
      totalAmount: 50000,
      paidAmount: 0,
      executionStatus: 'in_progress' as const,
      financialStatus: 'billed' as const,
      deadline: threeDaysAgo,
      updatedAt: tenDaysAgo,
    },
  ];
  for (const od of orders) {
    const order = await prisma.order.create({
      data: { ...od, companyId: c.id, partnerId, organizationId: org.id },
    });
    await prisma.lead.create({
      data: {
        partnerId,
        createdByUserId: u.id,
        organizationId: org.id,
        clientCompanyName: od.title,
        clientContactName: 'X',
        subject: od.title,
        status: 'promoted_to_order',
        productType: [],
        promotedOrderId: order.id,
      },
    });
  }

  await prisma.lead.createMany({
    data: [
      {
        partnerId,
        createdByUserId: u.id,
        clientCompanyName: 'Старый лид',
        clientContactName: 'X',
        subject: 'S',
        status: 'new',
        productType: [],
        createdAt: sevenDaysAgo,
      },
      {
        partnerId,
        createdByUserId: u.id,
        clientCompanyName: 'Свежий',
        clientContactName: 'X',
        subject: 'S',
        status: 'new',
        productType: [],
        createdAt: threeDaysAgo,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'AttC-' } } });
  await prisma.$disconnect();
});

describe('partner.dashboard.attention', () => {
  it('reports stuck orders updated more than 14 days ago', async () => {
    const a = await attention(prisma, { partnerId, scopeOrgIds: [] });
    const titles = a.stuckOrders.map((o) => o.title);
    expect(titles).toContain('Зависшая 20 дней');
    expect(titles).not.toContain('Свежая');
  });

  it('reports orders with deadline in the past and not paid', async () => {
    const a = await attention(prisma, { partnerId, scopeOrgIds: [] });
    const titles = a.overdueOrders.map((o) => o.title);
    expect(titles).toContain('Просроченный счёт');
  });

  it('returns hard cap of 10 per bucket', async () => {
    const a = await attention(prisma, { partnerId, scopeOrgIds: [] });
    expect(a.stuckOrders.length).toBeLessThanOrEqual(10);
    expect(a.overdueOrders.length).toBeLessThanOrEqual(10);
  });
});
