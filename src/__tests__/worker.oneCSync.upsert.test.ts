import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { syncOrganizationsProcessor } from '@/worker/processors/sync-organizations';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { syncPaymentsProcessor } from '@/worker/processors/sync-payments';
import { syncDocumentsProcessor } from '@/worker/processors/sync-documents';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import { FAKE_ORGS } from '@/lib/services/oneCSync/fixtures/orgs';
import { FAKE_ORDERS, FAKE_PAYMENTS, FAKE_DOCUMENTS } from '@/lib/services/oneCSync/fixtures/orders';
import type { SyncJobPayload } from '@/lib/jobs/types';

const FAKE_ORG_EXTERNAL_IDS = FAKE_ORGS.map((o) => o.externalId);
const FAKE_ORDER_EXTERNAL_IDS = FAKE_ORDERS.map((o) => o.externalId);
const FAKE_PAYMENT_EXTERNAL_IDS = FAKE_PAYMENTS.map((p) => p.externalId);
const FAKE_DOC_EXTERNAL_IDS = FAKE_DOCUMENTS.map((d) => d.externalId);
const PARTNER_SLUG = FAKE_ORGS[0].partnerExternalId!;

let prisma: PrismaClient;
let partnerId: string;

function job(): Job<SyncJobPayload> {
  return {
    id: 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    data: { triggeredAt: new Date().toISOString(), reason: 'manual' as const }
  } as Job<SyncJobPayload>;
}

async function cleanupDocs() {
  await prisma.document.deleteMany({ where: { externalId: { in: FAKE_DOC_EXTERNAL_IDS } } });
}
async function cleanupPayments() {
  await prisma.payment.deleteMany({ where: { externalId: { in: FAKE_PAYMENT_EXTERNAL_IDS } } });
}
async function cleanupOrders() {
  await prisma.order.deleteMany({ where: { externalId: { in: FAKE_ORDER_EXTERNAL_IDS } } });
}
async function cleanupOrgs() {
  const orgs = await prisma.organization.findMany({
    where: { externalId: { in: FAKE_ORG_EXTERNAL_IDS } },
    select: { id: true, companyId: true }
  });
  const orgIds = orgs.map((o) => o.id);
  const companyIds = orgs.map((o) => o.companyId).filter((id): id is string => Boolean(id));
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  if (companyIds.length) {
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }
}
async function cleanupAll() {
  await cleanupDocs();
  await cleanupPayments();
  await cleanupOrders();
  await cleanupOrgs();
}

async function deletePartnerCascade(pid: string) {
  const orgs = await prisma.organization.findMany({
    where: { partnerId: pid },
    select: { id: true, companyId: true }
  });
  const orgIds = orgs.map((o) => o.id);
  const companyIds = orgs.map((o) => o.companyId).filter((id): id is string => Boolean(id));

  const orderIds = (
    await prisma.order.findMany({
      where: { OR: [{ partnerId: pid }, { companyId: { in: companyIds } }] },
      select: { id: true }
    })
  ).map((o) => o.id);
  if (orderIds.length) {
    await prisma.document.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  await prisma.lead.deleteMany({ where: { partnerId: pid } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId: pid } });
  await prisma.notification.deleteMany({ where: { partnerId: pid } });
  await prisma.partnerUser.deleteMany({ where: { partnerId: pid } });
  await prisma.user.deleteMany({ where: { partnerId: pid } });
  if (orgIds.length) {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  if (companyIds.length) {
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }
  await prisma.partner.deleteMany({ where: { id: pid } });
}

async function deleteStalePartner() {
  const stale = await prisma.partner.findUnique({
    where: { slug: PARTNER_SLUG },
    select: { id: true }
  });
  if (stale) await deletePartnerCascade(stale.id);
}

beforeAll(async () => {
  process.env.ONE_C_ADAPTER = 'fake';
  resetOneCAdapter();
  prisma = new PrismaClient();
  await deleteStalePartner();
  await cleanupAll();
  const partner = await prisma.partner.create({
    data: { name: 'OneCSyncTestPartner', slug: PARTNER_SLUG, commissionRate: 0.1 }
  });
  partnerId = partner.id;
});

afterAll(async () => {
  await prisma.syncLog.deleteMany({
    where: { entity: { in: ['organization', 'order', 'payment', 'document'] } }
  });
  await deletePartnerCascade(partnerId);
  resetOneCAdapter();
  await prisma.$disconnect();
});

describe('syncOrganizationsProcessor', () => {
  it('creates orgs with resolved partner and auto-created companies', async () => {
    await cleanupAll();
    const result = await syncOrganizationsProcessor(job(), prisma);

    expect(result.pulled).toBe(FAKE_ORGS.length);
    expect(result.created).toBe(FAKE_ORGS.length);
    expect(result.skipped).toBe(0);

    const orgs = await prisma.organization.findMany({
      where: { externalId: { in: FAKE_ORG_EXTERNAL_IDS } },
      select: { partnerId: true, companyId: true, inn: true }
    });
    expect(orgs).toHaveLength(FAKE_ORGS.length);
    for (const org of orgs) {
      expect(org.partnerId).toBe(partnerId);
      expect(org.companyId).toBeTruthy();
      expect(org.inn).toBeTruthy();
    }
  });

  it('is idempotent on second run', async () => {
    const result = await syncOrganizationsProcessor(job(), prisma);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(FAKE_ORGS.length);
    expect(result.skipped).toBe(0);

    const count = await prisma.organization.count({
      where: { externalId: { in: FAKE_ORG_EXTERNAL_IDS } }
    });
    expect(count).toBe(FAKE_ORGS.length);
  });

  it('does not overwrite partnerId on update (cabinet-owned)', async () => {
    const otherPartner = await prisma.partner.create({
      data: { name: 'OtherPartner-' + Date.now(), commissionRate: 0.05 }
    });
    await prisma.organization.updateMany({
      where: { externalId: FAKE_ORG_EXTERNAL_IDS[0] },
      data: { partnerId: otherPartner.id }
    });

    await syncOrganizationsProcessor(job(), prisma);

    const reread = await prisma.organization.findUnique({
      where: { externalId: FAKE_ORG_EXTERNAL_IDS[0] },
      select: { partnerId: true }
    });
    expect(reread?.partnerId).toBe(otherPartner.id);

    await prisma.organization.updateMany({
      where: { externalId: FAKE_ORG_EXTERNAL_IDS[0] },
      data: { partnerId }
    });
    await prisma.partner.delete({ where: { id: otherPartner.id } });
  });
});

describe('syncOrdersProcessor', () => {
  beforeAll(async () => {
    await cleanupAll();
    await syncOrganizationsProcessor(job(), prisma);
  });

  it('creates orders linked to org and partner', async () => {
    await cleanupDocs();
    await cleanupPayments();
    await cleanupOrders();
    const result = await syncOrdersProcessor(job(), prisma);

    expect(result.pulled).toBe(FAKE_ORDERS.length);
    expect(result.created).toBe(FAKE_ORDERS.length);
    expect(result.skipped).toBe(0);

    const orders = await prisma.order.findMany({
      where: { externalId: { in: FAKE_ORDER_EXTERNAL_IDS } },
      select: { partnerId: true, companyId: true, executionStatus: true }
    });
    expect(orders).toHaveLength(FAKE_ORDERS.length);
    for (const o of orders) {
      expect(o.partnerId).toBe(partnerId);
      expect(o.companyId).toBeTruthy();
    }
  });

  it('is idempotent on second run', async () => {
    const result = await syncOrdersProcessor(job(), prisma);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(FAKE_ORDERS.length);

    const count = await prisma.order.count({
      where: { externalId: { in: FAKE_ORDER_EXTERNAL_IDS } }
    });
    expect(count).toBe(FAKE_ORDERS.length);
  });

  it('does not overwrite executionStatus on update (cabinet-owned)', async () => {
    await prisma.order.updateMany({
      where: { externalId: FAKE_ORDER_EXTERNAL_IDS[0] },
      data: { executionStatus: 'on_hold' }
    });

    await syncOrdersProcessor(job(), prisma);

    const reread = await prisma.order.findUnique({
      where: { externalId: FAKE_ORDER_EXTERNAL_IDS[0] },
      select: { executionStatus: true }
    });
    expect(reread?.executionStatus).toBe('on_hold');
  });

  it('writes Order.organizationId on create', async () => {
    await cleanupDocs();
    await cleanupPayments();
    await cleanupOrders();
    await syncOrdersProcessor(job(), prisma);

    const orders = await prisma.order.findMany({
      where: { externalId: { in: FAKE_ORDER_EXTERNAL_IDS } },
      select: { externalId: true, organizationId: true }
    });
    expect(orders).toHaveLength(FAKE_ORDERS.length);
    for (const o of orders) {
      expect(o.organizationId).toBeTruthy();
    }

    // each order's organizationId matches the org with corresponding externalId
    const orgByExt = new Map(
      (
        await prisma.organization.findMany({
          where: { externalId: { in: FAKE_ORG_EXTERNAL_IDS } },
          select: { id: true, externalId: true }
        })
      ).map((o) => [o.externalId, o.id])
    );
    const orderByExt = new Map(orders.map((o) => [o.externalId, o.organizationId]));
    for (const fakeOrder of FAKE_ORDERS) {
      const expectedOrgId = orgByExt.get(fakeOrder.organizationExternalId);
      expect(orderByExt.get(fakeOrder.externalId)).toBe(expectedOrgId);
    }
  });

  it('backfills Order.organizationId when existing record has null', async () => {
    // simulate legacy: null out organizationId on first order
    const target = FAKE_ORDER_EXTERNAL_IDS[0];
    await prisma.order.updateMany({
      where: { externalId: target },
      data: { organizationId: null }
    });
    const before = await prisma.order.findUnique({
      where: { externalId: target },
      select: { organizationId: true }
    });
    expect(before?.organizationId).toBeNull();

    await syncOrdersProcessor(job(), prisma);

    const after = await prisma.order.findUnique({
      where: { externalId: target },
      select: { organizationId: true }
    });
    expect(after?.organizationId).toBeTruthy();
  });

  it('does not overwrite existing non-null Order.organizationId', async () => {
    const target = FAKE_ORDER_EXTERNAL_IDS[0];

    // create alternate organization linked to same partner
    const altCompany = await prisma.company.create({
      data: { name: 'AltCompany-' + Date.now() }
    });
    const altOrg = await prisma.organization.create({
      data: {
        name: 'AltOrg-' + Date.now(),
        partnerId,
        companyId: altCompany.id
      }
    });

    // assign order to alt org manually
    await prisma.order.updateMany({
      where: { externalId: target },
      data: { organizationId: altOrg.id }
    });

    await syncOrdersProcessor(job(), prisma);

    const after = await prisma.order.findUnique({
      where: { externalId: target },
      select: { organizationId: true }
    });
    expect(after?.organizationId).toBe(altOrg.id);

    // restore: re-link to real org (matches fixture organizationExternalId)
    const realOrg = await prisma.organization.findUnique({
      where: { externalId: FAKE_ORDERS[0].organizationExternalId },
      select: { id: true }
    });
    await prisma.order.updateMany({
      where: { externalId: target },
      data: { organizationId: realOrg!.id }
    });
    await prisma.organization.delete({ where: { id: altOrg.id } });
    await prisma.company.delete({ where: { id: altCompany.id } });
  });

  it('skips orders when organization is missing, status warn in SyncLog', async () => {
    await cleanupDocs();
    await cleanupPayments();
    await cleanupOrders();
    await cleanupOrgs();

    const result = await syncOrdersProcessor(job(), prisma);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(FAKE_ORDERS.length);

    const lastLog = await prisma.syncLog.findFirst({
      where: { entity: 'order' },
      orderBy: { createdAt: 'desc' }
    });
    expect(lastLog?.status).toBe('warn');

    await syncOrganizationsProcessor(job(), prisma);
  });
});

describe('syncPaymentsProcessor', () => {
  beforeAll(async () => {
    await cleanupAll();
    await syncOrganizationsProcessor(job(), prisma);
    await syncOrdersProcessor(job(), prisma);
  });

  it('creates payments linked to the resolved order', async () => {
    await cleanupPayments();
    const result = await syncPaymentsProcessor(job(), prisma);

    expect(result.pulled).toBe(FAKE_PAYMENTS.length);
    expect(result.created).toBe(FAKE_PAYMENTS.length);
    expect(result.skipped).toBe(0);

    const payments = await prisma.payment.findMany({
      where: { externalId: { in: FAKE_PAYMENT_EXTERNAL_IDS } },
      select: { orderId: true, amount: true }
    });
    expect(payments).toHaveLength(FAKE_PAYMENTS.length);
    for (const p of payments) {
      expect(p.orderId).toBeTruthy();
      expect(Number(p.amount)).toBeGreaterThan(0);
    }
  });

  it('is idempotent on second run', async () => {
    const result = await syncPaymentsProcessor(job(), prisma);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(FAKE_PAYMENTS.length);

    const count = await prisma.payment.count({
      where: { externalId: { in: FAKE_PAYMENT_EXTERNAL_IDS } }
    });
    expect(count).toBe(FAKE_PAYMENTS.length);
  });
});

describe('syncDocumentsProcessor', () => {
  beforeAll(async () => {
    await cleanupAll();
    await syncOrganizationsProcessor(job(), prisma);
    await syncOrdersProcessor(job(), prisma);
  });

  it('creates docs with direction=incoming, generatedBy=system', async () => {
    await cleanupDocs();
    const result = await syncDocumentsProcessor(job(), prisma);

    expect(result.pulled).toBe(FAKE_DOCUMENTS.length);
    expect(result.created).toBe(FAKE_DOCUMENTS.length);

    const docs = await prisma.document.findMany({
      where: { externalId: { in: FAKE_DOC_EXTERNAL_IDS } },
      select: { type: true, direction: true, generatedBy: true, path: true }
    });
    expect(docs).toHaveLength(FAKE_DOCUMENTS.length);
    for (const d of docs) {
      expect(d.direction).toBe('incoming');
      expect(d.generatedBy).toBe('system');
      expect(d.path).toMatch(/^fake:\/\//);
    }
    expect(docs.map((d) => d.type).sort()).toEqual(['act', 'contract', 'invoice']);
  });

  it('is idempotent on second run', async () => {
    const result = await syncDocumentsProcessor(job(), prisma);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(FAKE_DOCUMENTS.length);

    const count = await prisma.document.count({
      where: { externalId: { in: FAKE_DOC_EXTERNAL_IDS } }
    });
    expect(count).toBe(FAKE_DOCUMENTS.length);
  });
});
