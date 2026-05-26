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

  await prisma.order.createMany({
    data: [
      {
        title: 'Зависшая 20 дней', companyId: c.id, partnerId, organizationId: org.id,
        totalAmount: 50000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed',
        updatedAt: twentyDaysAgo, createdAt: twentyDaysAgo
      },
      {
        title: 'Свежая', companyId: c.id, partnerId, organizationId: org.id,
        totalAmount: 50000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed',
        updatedAt: tenDaysAgo, createdAt: tenDaysAgo
      },
      {
        title: 'Просроченный счёт', companyId: c.id, partnerId, organizationId: org.id,
        totalAmount: 50000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed',
        deadline: threeDaysAgo, updatedAt: tenDaysAgo
      }
    ]
  });

  const u = await prisma.user.create({
    data: { email: `att-${Date.now()}@t.local`, passwordHash: 'x', name: 'L', role: 'partner', partnerId }
  });
  await prisma.lead.createMany({
    data: [
      {
        partnerId, createdByUserId: u.id,
        clientCompanyName: 'Старый лид', clientContactName: 'X', subject: 'S',
        status: 'new', productType: [], createdAt: sevenDaysAgo
      },
      {
        partnerId, createdByUserId: u.id,
        clientCompanyName: 'Свежий', clientContactName: 'X', subject: 'S',
        status: 'new', productType: [], createdAt: threeDaysAgo
      }
    ]
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

  it('reports leads in state "new" older than 5 days', async () => {
    const a = await attention(prisma, { partnerId, scopeOrgIds: [] });
    const names = a.staleLeads.map((l) => l.clientCompanyName);
    expect(names).toContain('Старый лид');
    expect(names).not.toContain('Свежий');
  });

  it('returns hard cap of 10 per bucket', async () => {
    const a = await attention(prisma, { partnerId, scopeOrgIds: [] });
    expect(a.stuckOrders.length).toBeLessThanOrEqual(10);
    expect(a.overdueOrders.length).toBeLessThanOrEqual(10);
    expect(a.staleLeads.length).toBeLessThanOrEqual(10);
  });
});
