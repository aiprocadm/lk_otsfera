import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { backfillOrderOrganizationId } from '@/lib/services/organization/backfillOrderOrg';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import { FAKE_ORGS } from '@/lib/services/oneCSync/fixtures/orgs';
import { FAKE_ORDERS } from '@/lib/services/oneCSync/fixtures/orders';

const PARTNER_SLUG = 'backfill-test-' + Date.now();
const FAKE_ORG_EXTS = FAKE_ORGS.map((o) => o.externalId);
const FAKE_ORDER_EXTS = FAKE_ORDERS.map((o) => o.externalId);

let prisma: PrismaClient;
let partnerId: string;
const createdCompanyIds: string[] = [];
const createdOrgIds: string[] = [];
const createdOrderIds: string[] = [];

async function cleanup() {
  if (createdOrderIds.length) {
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    createdOrderIds.length = 0;
  }
  await prisma.order.deleteMany({ where: { externalId: { in: FAKE_ORDER_EXTS } } });
  if (createdOrgIds.length) {
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    createdOrgIds.length = 0;
  }
  await prisma.organization.deleteMany({ where: { externalId: { in: FAKE_ORG_EXTS } } });
  if (createdCompanyIds.length) {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    createdCompanyIds.length = 0;
  }
  await prisma.syncLog.deleteMany({
    where: { entity: 'order', operation: 'update' }
  });
}

beforeAll(async () => {
  process.env.ONE_C_ADAPTER = 'fake';
  resetOneCAdapter();
  prisma = new PrismaClient();
  const partner = await prisma.partner.upsert({
    where: { slug: PARTNER_SLUG },
    update: {},
    create: { name: 'BackfillTestPartner', slug: PARTNER_SLUG, commissionRate: 0.1 }
  });
  partnerId = partner.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.partner.delete({ where: { id: partnerId } }).catch(() => undefined);
  resetOneCAdapter();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanup();
});

async function makeOrg(externalId: string | null, companyId?: string | null) {
  const company = companyId
    ? null
    : await prisma.company.create({ data: { name: 'BC-' + Math.random().toString(36).slice(2) } });
  if (company) createdCompanyIds.push(company.id);
  const cId = companyId ?? company!.id;
  const org = await prisma.organization.create({
    data: {
      name: 'BO-' + Math.random().toString(36).slice(2),
      externalId,
      partnerId,
      companyId: cId
    }
  });
  createdOrgIds.push(org.id);
  return { org, companyId: cId };
}

async function makeOrder(opts: {
  companyId: string;
  externalId?: string | null;
  organizationId?: string | null;
}) {
  const order = await prisma.order.create({
    data: {
      title: 'BackfillOrd-' + Math.random().toString(36).slice(2),
      companyId: opts.companyId,
      externalId: opts.externalId ?? null,
      organizationId: opts.organizationId ?? null,
      partnerId
    }
  });
  createdOrderIds.push(order.id);
  return order;
}

describe('backfillOrderOrganizationId', () => {
  it('backfills via 1C externalId', async () => {
    // Seed orgs matching FAKE_ORGS externalIds (FakeOneCAdapter returns FAKE_ORDERS referencing these)
    for (const fakeOrg of FAKE_ORGS) {
      await makeOrg(fakeOrg.externalId);
    }
    // Create orders with externalId matching FAKE_ORDERS, organizationId null
    for (const fakeOrder of FAKE_ORDERS) {
      const targetOrg = await prisma.organization.findUnique({
        where: { externalId: fakeOrder.organizationExternalId },
        select: { companyId: true }
      });
      await makeOrder({
        companyId: targetOrg!.companyId!,
        externalId: fakeOrder.externalId,
        organizationId: null
      });
    }

    const summary = await backfillOrderOrganizationId(prisma);
    expect(summary.matched_via_1c).toBe(FAKE_ORDERS.length);
    expect(summary.matched_via_company).toBe(0);
    expect(summary.left_null).toBe(0);

    const orders = await prisma.order.findMany({
      where: { externalId: { in: FAKE_ORDER_EXTS } },
      select: { organizationId: true }
    });
    for (const o of orders) {
      expect(o.organizationId).toBeTruthy();
    }
  });

  it('backfills via Company heuristic when Company has exactly 1 Organization', async () => {
    const { companyId } = await makeOrg(null);
    await makeOrder({ companyId, externalId: null, organizationId: null });
    await makeOrder({ companyId, externalId: null, organizationId: null });

    const summary = await backfillOrderOrganizationId(prisma);
    expect(summary.matched_via_company).toBe(2);
    expect(summary.left_null).toBe(0);
  });

  it('leaves null when Company has multiple Organizations', async () => {
    const { companyId } = await makeOrg(null);
    await makeOrg(null, companyId);
    await makeOrder({ companyId, externalId: null, organizationId: null });

    const summary = await backfillOrderOrganizationId(prisma);
    expect(summary.matched_via_company).toBe(0);
    expect(summary.left_null).toBe(1);
  });

  it('is idempotent — second run does not error and changes nothing', async () => {
    const { companyId, org } = await makeOrg(null);
    await makeOrder({ companyId, organizationId: org.id });

    const first = await backfillOrderOrganizationId(prisma);
    const second = await backfillOrderOrganizationId(prisma);
    expect(first.matched_via_1c).toBe(0);
    expect(first.matched_via_company).toBe(0);
    expect(second.matched_via_1c).toBe(0);
    expect(second.matched_via_company).toBe(0);
  });
});
