import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listPortfolio } from '@/lib/services/partner/portfolio';

let prisma: PrismaClient;
let partnerId: string;
let otherPartnerId: string;
let userId: string;
let orgIds: { withDebt: string; clean: string; empty: string; otherPartner: string };

// KPI-поля (ordersCount/debt) считаются ТОЛЬКО по заказам, видимым через лиды
// партнёра (F2: `promotedFromLead.partnerId`) — поэтому каждый заказ сидится
// вместе с промоутнутым лидом; заказ без лида в KPI не попадает.
async function createPromotedOrder(
  data: Parameters<PrismaClient['order']['create']>[0]['data']
): Promise<void> {
  const order = await prisma.order.create({ data });
  await prisma.lead.create({
    data: {
      partnerId,
      createdByUserId: userId,
      clientCompanyName: 'Портфель-Клиент',
      clientContactName: 'Контакт',
      subject: 'portfolio-it',
      status: 'promoted_to_order',
      promotedOrderId: order.id,
    },
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const partner = await prisma.partner.create({ data: { name: 'TestP-' + Date.now() } });
  const other = await prisma.partner.create({ data: { name: 'OtherP-' + Date.now() } });
  partnerId = partner.id;
  otherPartnerId = other.id;

  const user = await prisma.user.create({
    data: {
      email: `portfolio-it-${Date.now()}@test.local`,
      name: 'Portfolio IT',
      role: 'partner',
      partnerId,
      passwordHash: null,
      isActive: true,
    },
  });
  userId = user.id;

  const company = await prisma.company.create({ data: { name: 'C-' + Date.now() } });

  const withDebt = await prisma.organization.create({
    data: { name: 'OrgДолг', partnerId, companyId: company.id, inn: '7700000001' },
  });
  const clean = await prisma.organization.create({
    data: { name: 'OrgЧистый', partnerId, companyId: company.id, inn: '7700000002' },
  });
  const empty = await prisma.organization.create({
    data: { name: 'OrgПустой', partnerId, companyId: company.id, inn: '7700000003' },
  });
  const otherPartnerOrg = await prisma.organization.create({
    data: { name: 'OrgЧужой', partnerId: otherPartnerId, companyId: company.id },
  });

  await createPromotedOrder({
    title: 'Заказ с долгом',
    companyId: company.id,
    partnerId,
    organizationId: withDebt.id,
    totalAmount: 100000,
    paidAmount: 40000,
    executionStatus: 'in_progress',
    financialStatus: 'partially_paid',
  });
  // Отменённый заказ: попадает в ordersCount, но исключён из debt.
  await createPromotedOrder({
    title: 'Отменённый',
    companyId: company.id,
    partnerId,
    organizationId: withDebt.id,
    totalAmount: 77000,
    paidAmount: 0,
    executionStatus: 'cancelled',
    financialStatus: 'not_billed',
  });
  await createPromotedOrder({
    title: 'Завершённая',
    companyId: company.id,
    partnerId,
    organizationId: clean.id,
    totalAmount: 50000,
    paidAmount: 50000,
    executionStatus: 'completed',
    financialStatus: 'paid',
  });

  orgIds = {
    withDebt: withDebt.id,
    clean: clean.id,
    empty: empty.id,
    otherPartner: otherPartnerOrg.id,
  };
});

afterAll(async () => {
  // Lead.promotedOrderId → Order: лиды удаляются до заказов.
  await prisma.lead.deleteMany({ where: { partnerId: { in: [partnerId, otherPartnerId] } } });
  await prisma.order.deleteMany({ where: { partnerId: { in: [partnerId, otherPartnerId] } } });
  await prisma.organization.deleteMany({
    where: { partnerId: { in: [partnerId, otherPartnerId] } },
  });
  await prisma.user.delete({ where: { id: userId } });
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
    const emptyOrg = result.items.find((o) => o.name === 'OrgПустой');

    // OrgДолг: in_progress (100000-40000) + отменённый (в count, но не в debt).
    expect(debtOrg!.ordersCount).toBe(2);
    expect(debtOrg!.debt).toBe('60000.00');
    // OrgЧистый: один полностью оплаченный заказ.
    expect(cleanOrg!.ordersCount).toBe(1);
    expect(cleanOrg!.debt).toBe('0.00');
    // OrgПустой: заказов нет вовсе — нулевые KPI.
    expect(emptyOrg!.ordersCount).toBe(0);
    expect(emptyOrg!.debt).toBe('0.00');
  });

  it('returns empty page when search matches nothing (no KPI query issued)', async () => {
    const result = await listPortfolio(prisma, {
      partnerId,
      search: 'нет-такой-организации-zzz',
      take: 50,
      skip: 0,
    });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('respects scopeOrgIds filter', async () => {
    const result = await listPortfolio(prisma, {
      partnerId,
      scopeOrgIds: [orgIds.withDebt],
      take: 50,
      skip: 0,
    });
    const names = result.items.map((o) => o.name);
    expect(names).toEqual(['OrgДолг']);
  });

  it('filters by name search (case-insensitive substring)', async () => {
    const result = await listPortfolio(prisma, {
      partnerId,
      search: 'долг',
      take: 50,
      skip: 0,
    });
    expect(result.items.map((o) => o.name)).toEqual(['OrgДолг']);
  });
});
