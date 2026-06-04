import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  getOrgFinanceKpis,
  listOrgPayments,
  getOrgIntermediaryCommission
} from '@/lib/services/organization/finance';

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgId: string;
const STAMP = Date.now();

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({
    data: { name: `FinP-${STAMP}`, commissionRate: new Prisma.Decimal('0.1') }
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `FinC-${STAMP}` } });
  companyId = company.id;
  const org = await prisma.organization.create({
    data: {
      name: `FinOrg-${STAMP}`,
      partnerId,
      companyId,
      partnerCommissionRate: new Prisma.Decimal('0.15')
    }
  });
  orgId = org.id;

  // billed 100000 / paid 40000 (partially_paid); billed 50000 / paid 50000 (paid);
  // not_billed 9999 (excluded from KPIs + commission).
  const o1 = await prisma.order.create({
    data: {
      title: 'O1',
      organizationId: orgId,
      companyId,
      financialStatus: 'partially_paid',
      totalAmount: new Prisma.Decimal('100000'),
      paidAmount: new Prisma.Decimal('40000'),
      vatIncluded: true
    }
  });
  const o2 = await prisma.order.create({
    data: {
      title: 'O2',
      organizationId: orgId,
      companyId,
      financialStatus: 'paid',
      totalAmount: new Prisma.Decimal('50000'),
      paidAmount: new Prisma.Decimal('50000'),
      vatIncluded: true
    }
  });
  await prisma.order.create({
    data: {
      title: 'O3',
      organizationId: orgId,
      companyId,
      financialStatus: 'not_billed',
      totalAmount: new Prisma.Decimal('9999'),
      paidAmount: new Prisma.Decimal('0'),
      vatIncluded: true
    }
  });
  await prisma.payment.create({
    data: { orderId: o1.id, amount: new Prisma.Decimal('40000'), paidAt: new Date('2026-05-01'), method: 'bank' }
  });
  await prisma.payment.create({
    data: { orderId: o2.id, amount: new Prisma.Decimal('50000'), paidAt: new Date('2026-05-10'), method: 'bank' }
  });
  await prisma.payment.create({
    data: {
      orderId: o2.id,
      amount: new Prisma.Decimal('5000'),
      paidAt: new Date('2026-05-11'),
      isRefund: true,
      note: 'возврат'
    }
  });
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { order: { organizationId: orgId } } });
  await prisma.order.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

describe('getOrgFinanceKpis', () => {
  it('sums billed/paid over billed-ish orders, excludes not_billed', async () => {
    const k = await getOrgFinanceKpis(prisma, orgId);
    expect(k.billed).toBe('150000.00');
    expect(k.paid).toBe('90000.00');
    expect(k.outstanding).toBe('60000.00');
  });
});

describe('listOrgPayments', () => {
  it('returns all payments (incl. refunds) newest-first with order ref', async () => {
    const rows = await listOrgPayments(prisma, { organizationId: orgId });
    expect(rows).toHaveLength(3);
    expect(rows[0].isRefund).toBe(true); // 2026-05-11 is newest
    expect(rows.every((r) => typeof r.orderId === 'string')).toBe(true);
  });
});

describe('getOrgIntermediaryCommission', () => {
  it('uses org override rate (0.15) over partner default, vatMode full', async () => {
    const c = await getOrgIntermediaryCommission(prisma, orgId);
    expect(c.effectiveRate).toBe('0.15');
    // base = 100000 + 50000 = 150000 (not_billed excluded); commission = 150000 * 0.15
    expect(c.totalCommission).toBe('22500.00');
    expect(c.perOrder).toHaveLength(2);
  });
});
