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
  await prisma.organization.create({
    data: { name: 'A', partnerId, companyId: company.id }
  });

  await prisma.order.createMany({
    data: [
      {
        title: 'Открытая 1', companyId: company.id, partnerId,
        totalAmount: 100000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed'
      },
      {
        title: 'Открытая 2', companyId: company.id, partnerId,
        totalAmount: 80000, paidAmount: 30000,
        executionStatus: 'in_progress', financialStatus: 'partially_paid'
      },
      {
        title: 'Завершённая, оплачена в этом месяце', companyId: company.id, partnerId,
        totalAmount: 200000, paidAmount: 200000,
        executionStatus: 'completed', financialStatus: 'paid',
        closedAt: new Date(),
        paidAt: new Date()
      },
      {
        title: 'Отменённая', companyId: company.id, partnerId,
        totalAmount: 500000, paidAmount: 0,
        executionStatus: 'cancelled', financialStatus: 'not_billed'
      }
    ]
  });

  const u = await prisma.user.create({
    data: { email: `kpi-${Date.now()}@t.local`, passwordHash: 'x', name: 'L', role: 'partner', partnerId }
  });
  await prisma.lead.createMany({
    data: [
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L1', clientContactName: 'X', subject: 'S1', status: 'new', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L2', clientContactName: 'X', subject: 'S2', status: 'in_review', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L3', clientContactName: 'X', subject: 'S3', status: 'qualified', productType: [] },
      { partnerId, createdByUserId: u.id, clientCompanyName: 'L4', clientContactName: 'X', subject: 'S4', status: 'promoted_to_order', productType: [] },
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

  it('counts leads in active states (new, in_review, qualified)', async () => {
    const k = await kpis(prisma, { partnerId, scopeOrgIds: [] });
    expect(k.activeLeads).toBe(3);
  });

  it('estimates commission for current month from paid orders × partner.commissionRate', async () => {
    const k = await kpis(prisma, { partnerId, scopeOrgIds: [] });
    expect(k.commissionThisMonth).toBe('20000.00');
  });
});
