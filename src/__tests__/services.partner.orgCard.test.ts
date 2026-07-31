import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getOrgCard } from '@/lib/services/partner/orgCard';

let prisma: PrismaClient;
let partnerId: string;
let orgId: string;
let companyId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'OcP-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'OcC-' + Date.now() } });
  companyId = c.id;
  const org = await prisma.organization.create({
    data: { name: 'OrgЦентр', partnerId, companyId: c.id, inn: '7700000099' },
  });
  orgId = org.id;

  await prisma.order.create({
    data: {
      title: 'Один',
      companyId,
      partnerId,
      organizationId: orgId,
      totalAmount: 1000,
      paidAmount: 200,
      executionStatus: 'in_progress',
      financialStatus: 'partially_paid',
    },
  });
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('getOrgCard', () => {
  it('returns header data: name, inn, assignedManagerUserId, partnerCommissionRate', async () => {
    const card = await getOrgCard(prisma, { orgId, partnerId });
    expect(card).not.toBeNull();
    expect(card!.name).toBe('OrgЦентр');
    expect(card!.inn).toBe('7700000099');
    expect(card!.partnerCommissionRate).toBeNull();
  });

  it('computes KPI: ordersCount and debt', async () => {
    const card = await getOrgCard(prisma, { orgId, partnerId });
    expect(card!.kpi.ordersCount).toBe(1);
    expect(card!.kpi.debt).toBe('800.00');
  });

  it('returns null if org belongs to another partner', async () => {
    const card = await getOrgCard(prisma, { orgId, partnerId: 'other' });
    expect(card).toBeNull();
  });
});
