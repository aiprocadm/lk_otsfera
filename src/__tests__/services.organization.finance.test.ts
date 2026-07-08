import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import {
  getOrgFinanceKpis,
  getOrgFinanceKpisForOrgs,
  listOrgPayments,
  listOrgPaymentsForOrgs,
  getOrgIntermediaryCommission,
  getOrgIntermediaryCommissionForOrgs
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
    data: { organizationId: orgId, orderId: o1.id, amount: new Prisma.Decimal('40000'), paidAt: new Date('2026-05-01'), method: 'bank' }
  });
  await prisma.payment.create({
    data: { organizationId: orgId, orderId: o2.id, amount: new Prisma.Decimal('50000'), paidAt: new Date('2026-05-10'), method: 'bank' }
  });
  await prisma.payment.create({
    data: {
      organizationId: orgId,
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

  it('surfaces order-less (org-level, 1C-imported) payments with orderId=null', async () => {
    // Such a payment is INVISIBLE to the old order-based filter; the org-based
    // filter must return it.
    const imported = await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: null,
        amount: new Prisma.Decimal('12345'),
        paidAt: new Date('2026-05-20'),
        method: 'import'
      }
    });
    try {
      const rows = await listOrgPayments(prisma, { organizationId: orgId });
      const row = rows.find((r) => r.id === imported.id);
      expect(row).toBeDefined();
      expect(row?.orderId).toBeNull();
      expect(row?.orderNumber).toBeNull();
      expect(row?.amount).toBe('12345.00');
    } finally {
      await prisma.payment.delete({ where: { id: imported.id } });
    }
  });

  it('exposes vatAmount/purpose/paymentOrderNumber/enteredByName in ledger row (§7.1)', async () => {
    // Create a payment with the new §7.1 fields set
    const richPayment = await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: null,
        amount: new Prisma.Decimal('18000'),
        vatAmount: new Prisma.Decimal('3000'),
        purpose: 'Оплата по договору №99',
        paymentOrderNumber: 'ПП-099',
        paidAt: new Date('2026-05-25'),
        method: 'bank'
        // enteredById: null (no actor in WriteCtx; future work)
      }
    });
    try {
      const rows = await listOrgPayments(prisma, { organizationId: orgId });
      const row = rows.find((r) => r.id === richPayment.id);
      expect(row).toBeDefined();
      expect(row?.vatAmount).toBe('3000.00');
      expect(row?.purpose).toBe('Оплата по договору №99');
      expect(row?.paymentOrderNumber).toBe('ПП-099');
      expect(row?.enteredByName).toBeNull(); // no actor yet
    } finally {
      await prisma.payment.delete({ where: { id: richPayment.id } });
    }
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

  it('standalone org (no partner, no override) → empty commission, KPIs intact', async () => {
    const c3 = await prisma.company.create({ data: { name: `FinC3-${STAMP}` } });
    const solo = await prisma.organization.create({
      data: { name: `FinSolo-${STAMP}`, companyId: c3.id } // ни partnerId, ни override
    });
    try {
      await prisma.order.create({
        data: {
          title: 'S1',
          organizationId: solo.id,
          companyId: c3.id,
          financialStatus: 'billed',
          totalAmount: new Prisma.Decimal('7000'),
          paidAmount: new Prisma.Decimal('0'),
          vatIncluded: true
        }
      });
      const c = await getOrgIntermediaryCommission(prisma, solo.id);
      expect(c).toEqual({ effectiveRate: '0', totalCommission: '0.00', perOrder: [] });
      // KPI при этом считаются как обычно.
      const kpis = await getOrgFinanceKpis(prisma, solo.id);
      expect(kpis.billed).toBe('7000.00');
    } finally {
      await prisma.order.deleteMany({ where: { organizationId: solo.id } });
      await prisma.organization.deleteMany({ where: { id: solo.id } });
      await prisma.company.deleteMany({ where: { id: c3.id } });
    }
  });

  it('falls back to the partner default rate when the org has no override', async () => {
    const company2 = await prisma.company.create({ data: { name: `FinC2-${STAMP}` } });
    const org2 = await prisma.organization.create({
      data: { name: `FinOrg2-${STAMP}`, partnerId, companyId: company2.id } // no partnerCommissionRate
    });
    try {
      await prisma.order.create({
        data: {
          title: 'O2-1',
          organizationId: org2.id,
          companyId: company2.id,
          financialStatus: 'billed',
          totalAmount: new Prisma.Decimal('10000'),
          paidAmount: new Prisma.Decimal('0'),
          vatIncluded: true
        }
      });
      const c = await getOrgIntermediaryCommission(prisma, org2.id);
      expect(c.effectiveRate).toBe('0.1'); // partner default (commissionRate 0.1)
      expect(c.totalCommission).toBe('1000.00'); // 10000 * 0.1
    } finally {
      await prisma.order.deleteMany({ where: { organizationId: org2.id } });
      await prisma.organization.deleteMany({ where: { id: org2.id } });
      await prisma.company.deleteMany({ where: { id: company2.id } });
    }
  });
});

describe('batch variants (менеджерская витрина: N организаций → 1-2 запроса)', () => {
  it('empty id list → empty maps without touching the DB', async () => {
    expect((await getOrgFinanceKpisForOrgs(prisma, [])).size).toBe(0);
    expect((await getOrgIntermediaryCommissionForOrgs(prisma, [])).size).toBe(0);
    expect((await listOrgPaymentsForOrgs(prisma, [])).size).toBe(0);
  });

  it('listOrgPaymentsForOrgs: rows match the singular ledger; unknown org → []', async () => {
    const [batch, singular] = await Promise.all([
      listOrgPaymentsForOrgs(prisma, [orgId, 'no-such-org']),
      listOrgPayments(prisma, { organizationId: orgId })
    ]);
    expect(batch.get(orgId)).toEqual(singular);
    expect(batch.get(orgId)).toHaveLength(3);
    expect(batch.get('no-such-org')).toEqual([]);
  });

  it('listOrgPaymentsForOrgs: perOrgTake обрезает до новейших внутри КАЖДОЙ организации', async () => {
    const batch = await listOrgPaymentsForOrgs(prisma, [orgId], 1);
    expect(batch.get(orgId)).toHaveLength(1);
    expect(batch.get(orgId)![0].isRefund).toBe(true); // 2026-05-11 — новейший платёж
  });

  it('listOrgPaymentsForOrgs: vatAmount/purpose/enteredByName маппятся из джойнов', async () => {
    const user = await prisma.user.create({
      data: {
        email: `fin-batch-${STAMP}@test.local`,
        name: 'Финансист',
        role: 'manager',
        passwordHash: null,
        isActive: true
      }
    });
    const rich = await prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: null,
        amount: new Prisma.Decimal('7777'),
        vatAmount: new Prisma.Decimal('1111'),
        purpose: 'Батч-тест',
        paymentOrderNumber: 'ПП-777',
        paidAt: new Date('2026-05-30'),
        method: 'bank',
        enteredById: user.id
      }
    });
    try {
      const batch = await listOrgPaymentsForOrgs(prisma, [orgId]);
      const row = batch.get(orgId)!.find((r) => r.id === rich.id);
      expect(row).toMatchObject({
        amount: '7777.00',
        vatAmount: '1111.00',
        purpose: 'Батч-тест',
        paymentOrderNumber: 'ПП-777',
        enteredByName: 'Финансист',
        orderId: null,
        orderNumber: null
      });
    } finally {
      await prisma.payment.delete({ where: { id: rich.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('unknown org id still yields a (zero) entry — consumers can `get()!` safely', async () => {
    const kpis = await getOrgFinanceKpisForOrgs(prisma, ['no-such-org']);
    expect(kpis.get('no-such-org')).toEqual({ billed: '0.00', paid: '0.00', outstanding: '0.00' });
    const comm = await getOrgIntermediaryCommissionForOrgs(prisma, ['no-such-org']);
    expect(comm.get('no-such-org')).toEqual({ effectiveRate: '0', totalCommission: '0.00', perOrder: [] });
  });

  it('multi-org batch matches singular results; rated org without orders → zero total with its rate', async () => {
    const org3 = await prisma.organization.create({
      data: {
        name: `FinOrg3-${STAMP}`,
        partnerId,
        companyId,
        partnerCommissionRate: new Prisma.Decimal('0.2') // ставка есть, заказов нет
      }
    });
    try {
      const [kpis, comm] = await Promise.all([
        getOrgFinanceKpisForOrgs(prisma, [orgId, org3.id]),
        getOrgIntermediaryCommissionForOrgs(prisma, [orgId, org3.id])
      ]);
      // Главный org — те же цифры, что и в одиночных тестах выше.
      expect(kpis.get(orgId)).toEqual({ billed: '150000.00', paid: '90000.00', outstanding: '60000.00' });
      expect(comm.get(orgId)!.totalCommission).toBe('22500.00');
      expect(comm.get(orgId)!.perOrder).toHaveLength(2);
      // org3: ставка резолвится, но заказов нет → нулевая комиссия.
      expect(comm.get(org3.id)).toEqual({ effectiveRate: '0.2', totalCommission: '0.00', perOrder: [] });
      expect(kpis.get(org3.id)).toEqual({ billed: '0.00', paid: '0.00', outstanding: '0.00' });
    } finally {
      await prisma.organization.deleteMany({ where: { id: org3.id } });
    }
  });
});
