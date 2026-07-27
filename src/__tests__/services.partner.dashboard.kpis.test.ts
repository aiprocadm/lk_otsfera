import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { kpis } from '@/lib/services/partner/dashboard';

let prisma: PrismaClient;
let partnerId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({
    data: { name: 'KpiP-' + Date.now(), commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: 'KpiC-' + Date.now() } });
  const org = await prisma.organization.create({
    data: { name: 'A', partnerId, companyId: company.id }
  });

  const u = await prisma.user.create({
    data: { email: `kpi-${Date.now()}@t.local`, passwordHash: 'x', name: 'L', role: 'partner', partnerId }
  });

  // F2: a partner sees an order ONLY via its own lead. Each order is created then
  // linked to a promoting lead (promotedOrderId), so the dashboard counts it.
  const orders = [
    { title: 'Открытая 1', totalAmount: 100000, paidAmount: 0, executionStatus: 'in_progress' as const, financialStatus: 'billed' as const },
    { title: 'Открытая 2', totalAmount: 80000, paidAmount: 30000, executionStatus: 'in_progress' as const, financialStatus: 'partially_paid' as const },
    { title: 'Завершённая, оплачена в этом месяце', totalAmount: 200000, paidAmount: 200000, executionStatus: 'completed' as const, financialStatus: 'paid' as const, closedAt: new Date(), paidAt: new Date() },
    { title: 'Отменённая', totalAmount: 500000, paidAmount: 0, executionStatus: 'cancelled' as const, financialStatus: 'not_billed' as const }
  ];
  for (const od of orders) {
    const order = await prisma.order.create({ data: { ...od, companyId: company.id, partnerId, organizationId: org.id } });
    await prisma.lead.create({ data: { partnerId, createdByUserId: u.id, organizationId: org.id, clientCompanyName: od.title, clientContactName: 'X', subject: od.title, status: 'promoted_to_order', productType: [], promotedOrderId: order.id } });
  }

  // Active/other leads for the activeLeads KPI (not promoted to orders).
  await prisma.lead.createMany({
    data: [
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L1', clientContactName: 'X', subject: 'S1', status: 'new', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L2', clientContactName: 'X', subject: 'S2', status: 'in_review', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L3', clientContactName: 'X', subject: 'S3', status: 'qualified', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L5', clientContactName: 'X', subject: 'S5', status: 'rejected', productType: [] }
    ]
  });
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'KpiC-' } } });
  await prisma.$disconnect();
});

describe('partner.dashboard.kpis', () => {
  it('counts open orders (executionStatus in pending|in_progress)', async () => {
    const k = await kpis(prisma, { partnerId, scopeOrgIds: [] });
    expect(k.openOrders).toBe(2);
  });

  it('sums outstanding (totalAmount - paidAmount) for non-cancelled orders', async () => {
    const k = await kpis(prisma, { partnerId, scopeOrgIds: [] });
    expect(k.outstanding).toBe('150000.00');
  });

  it('estimates commission for current month from paid orders × partner.commissionRate', async () => {
    const k = await kpis(prisma, { partnerId, scopeOrgIds: [] });
    expect(k.commissionThisMonth).toBe('20000.00');
  });
});
