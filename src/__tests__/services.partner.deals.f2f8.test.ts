import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listPartnerDeals } from '@/lib/services/partner/deals';

// T3 F2 + F8: a partner sees an order ONLY via its own lead (promotedFromLead),
// and each deal shows its OWN organization (no companyId→org map collision when
// two orgs share a company).
let prisma: PrismaClient;
let partnerId: string;
let orgAId: string;
let orgBId: string;
let visibleAId: string;
let importedId: string;
let visibleBId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const p = await prisma.partner.create({ data: { name: 'F2P-' + Date.now() } });
  partnerId = p.id;
  const c = await prisma.company.create({ data: { name: 'F2C-' + Date.now() } });
  // F8: two orgs sharing ONE company.
  const orgA = await prisma.organization.create({ data: { name: 'OrgA', partnerId, companyId: c.id } });
  const orgB = await prisma.organization.create({ data: { name: 'OrgB', partnerId, companyId: c.id } });
  orgAId = orgA.id; orgBId = orgB.id;
  const u = await prisma.user.create({ data: { email: `f2-${Date.now()}@t.local`, passwordHash: 'x', name: 'L', role: 'partner', partnerId } });

  async function order(title: string, organizationId: string) {
    return prisma.order.create({ data: { title, companyId: c.id, partnerId, organizationId, totalAmount: 1000, paidAmount: 0, executionStatus: 'in_progress', financialStatus: 'billed' } });
  }
  async function promote(orderId: string, organizationId: string) {
    await prisma.lead.create({ data: { partnerId, createdByUserId: u.id, organizationId, clientCompanyName: 'c', clientContactName: 'n', subject: 's', status: 'promoted_to_order', productType: [], promotedOrderId: orderId } });
  }

  const visibleA = await order('Видимый A', orgAId); visibleAId = visibleA.id; await promote(visibleAId, orgAId);
  const imported = await order('Импортированный (без лида)', orgAId); importedId = imported.id; // NO lead → invisible under F2
  const visibleB = await order('Видимый B', orgBId); visibleBId = visibleB.id; await promote(visibleBId, orgBId);
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { partnerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { name: { startsWith: 'F2C-' } } });
  await prisma.$disconnect();
});

describe('listPartnerDeals — F2 (lead-based visibility)', () => {
  it('shows only lead-promoted orders, not imported partnerId-only orders', async () => {
    const { rows } = await listPartnerDeals(prisma, { partnerId, take: 50, skip: 0 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(visibleAId);
    expect(ids).toContain(visibleBId);
    expect(ids).not.toContain(importedId); // F2: imported order is invisible
  });
});

describe('listPartnerDeals — F8 (per-order organization, no collision)', () => {
  it('each deal shows its own organization even when two orgs share a company', async () => {
    const { rows } = await listPartnerDeals(prisma, { partnerId, take: 50, skip: 0 });
    const a = rows.find((r) => r.id === visibleAId);
    const b = rows.find((r) => r.id === visibleBId);
    expect(a?.organizationName).toBe('OrgA');
    expect(b?.organizationName).toBe('OrgB');
    expect(a?.organizationId).toBe(orgAId);
    expect(b?.organizationId).toBe(orgBId);
  });
});
