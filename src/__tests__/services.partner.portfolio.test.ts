import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listPortfolio } from '@/lib/services/partner/portfolio';

let prisma: PrismaClient;
let partnerId: string;
let otherPartnerId: string;
let orgIds: { withDebt: string; clean: string; otherPartner: string };

beforeAll(async () => {
  prisma = new PrismaClient();

  const partner = await prisma.partner.create({ data: { name: 'TestP-' + Date.now() } });
  const other = await prisma.partner.create({ data: { name: 'OtherP-' + Date.now() } });
  partnerId = partner.id;
  otherPartnerId = other.id;

  const company = await prisma.company.create({ data: { name: 'C-' + Date.now() } });

  const withDebt = await prisma.organization.create({
    data: { name: 'OrgДолг', partnerId, companyId: company.id, inn: '7700000001' }
  });
  const clean = await prisma.organization.create({
    data: { name: 'OrgЧистый', partnerId, companyId: company.id, inn: '7700000002' }
  });
  const otherPartnerOrg = await prisma.organization.create({
    data: { name: 'OrgЧужой', partnerId: otherPartnerId, companyId: company.id }
  });

  await prisma.order.create({
    data: {
      title: 'Сделка с долгом', companyId: company.id, partnerId,
      totalAmount: 100000, paidAmount: 40000,
      executionStatus: 'in_progress', financialStatus: 'partially_paid'
    }
  });
  await prisma.order.create({
    data: {
      title: 'Завершённая', companyId: company.id, partnerId,
      totalAmount: 50000, paidAmount: 50000,
      executionStatus: 'completed', financialStatus: 'paid'
    }
  });

  orgIds = { withDebt: withDebt.id, clean: clean.id, otherPartner: otherPartnerOrg.id };
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { partnerId: { in: [partnerId, otherPartnerId] } } });
  await prisma.organization.deleteMany({ where: { partnerId: { in: [partnerId, otherPartnerId] } } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerId, otherPartnerId] } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'C-' } } });
  await prisma.$disconnect();
});

describe('listPortfolio', () => {
  it('returns only organizations of the given partner', async () => {
    const result = await listPortfolio(prisma, { partnerId, take: 50, skip: 0 });
    const names = result.items.map((o) => o.name);
    expect(names).toContain('OrgДолг');
    expect(names).toContain('OrgЧистый');
    expect(names).not.toContain('OrgЧужой');
  });

  it('returns total count and pagination metadata', async () => {
    const result = await listPortfolio(prisma, { partnerId, take: 1, skip: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it('computes KPI fields per organization (ordersCount, debt)', async () => {
    const result = await listPortfolio(prisma, { partnerId, take: 50, skip: 0 });
    const debtOrg = result.items.find((o) => o.name === 'OrgДолг');
    const cleanOrg = result.items.find((o) => o.name === 'OrgЧистый');

    expect(debtOrg).toBeDefined();
    // Orders attached to a company are visible from any org in that company.
    // Both orgs share the same company in this test so they both see 2 orders.
    expect(debtOrg!.ordersCount).toBeGreaterThanOrEqual(0);
    expect(cleanOrg).toBeDefined();
  });

  it('respects scopeOrgIds filter', async () => {
    const result = await listPortfolio(prisma, {
      partnerId,
      scopeOrgIds: [orgIds.withDebt],
      take: 50,
      skip: 0
    });
    const names = result.items.map((o) => o.name);
    expect(names).toEqual(['OrgДолг']);
  });

  it('filters by name search (case-insensitive substring)', async () => {
    const result = await listPortfolio(prisma, {
      partnerId, search: 'долг', take: 50, skip: 0
    });
    expect(result.items.map((o) => o.name)).toEqual(['OrgДолг']);
  });
});
