import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';

// DOC-03: the writer now fetches the 1C file into object storage (S3) and stores a bucket
// key. The fake adapter emits unfetchable `fake://` URLs, so stub the fetch-store
// to return a deterministic storage key (no network / no object storage in tests).
vi.mock('@/lib/services/oneCSync/document-fetch', () => ({
  fetchAndStore1CDocument: vi.fn(
    async (a: { orderId: string; name: string }) => `orders/${a.orderId}/1c/stored-${a.name}`
  ),
}));
import { syncOrganizationsProcessor } from '@/worker/processors/sync-organizations';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';
import { syncPaymentsProcessor } from '@/worker/processors/sync-payments';
import { syncDocumentsProcessor } from '@/worker/processors/sync-documents';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import { FAKE_ORGS } from '@/lib/services/oneCSync/fixtures/orgs';
import {
  FAKE_ORDERS,
  FAKE_PAYMENTS,
  FAKE_DOCUMENTS,
} from '@/lib/services/oneCSync/fixtures/orders';
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
    data: { triggeredAt: new Date().toISOString(), reason: 'manual' as const },
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
    select: { id: true, companyId: true },
  });
  const orgIds = orgs.map((o) => o.id);
  const companyIds = orgs.map((o) => o.companyId).filter((id): id is string => Boolean(id));
  if (orgIds.length) {
    // OrganizationUser must die before its parent Organization — seed may have
    // left memberships for org@demo.local in these orgs.
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  if (companyIds.length) {
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }
}
async function cleanupAll() {
  await prisma.syncState.deleteMany({});
  await cleanupDocs();
  await cleanupPayments();
  await cleanupOrders();
  await cleanupOrgs();
}

// Robust cascade: deletes EVERYTHING transitively under a partner in correct FK
// order. Must tolerate rows other tests attached to this partner's shared seed
// data (e.g. comments on its orders, audit logs for its users) — the suite
// shares one Postgres, so this teardown can't assume it created all the children.
async function deletePartnerCascade(pid: string) {
  const orgs = await prisma.organization.findMany({
    where: { partnerId: pid },
    select: { id: true, companyId: true },
  });
  const orgIds = orgs.map((o) => o.id);
  const companyIds = orgs.map((o) => o.companyId).filter((id): id is string => Boolean(id));

  const orderIds = (
    await prisma.order.findMany({
      where: {
        OR: [
          { partnerId: pid },
          { companyId: { in: companyIds } },
          { organizationId: { in: orgIds } },
        ],
      },
      select: { id: true },
    })
  ).map((o) => o.id);

  const userIds = (
    await prisma.user.findMany({ where: { partnerId: pid }, select: { id: true } })
  ).map((u) => u.id);

  // Leads FK orders (promotedOrderId) and users (createdBy/assignedManager),
  // so they (and their attachments) must die before both.
  const leadIds = (
    await prisma.lead.findMany({
      where: { OR: [{ partnerId: pid }, { organizationId: { in: orgIds } }] },
      select: { id: true },
    })
  ).map((l) => l.id);
  if (leadIds.length) {
    await prisma.leadAttachment.deleteMany({ where: { leadId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  }

  // Order children → orders. Comment and Upload also FK Order and were missing
  // before — another test leaving a comment on this partner's seed order would
  // make the bare order.deleteMany() throw.
  if (orderIds.length) {
    await prisma.comment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.upload.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.document.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    // CommissionStatementItem has FKs to both Order and CommissionStatement —
    // it must die before either.
    await prisma.commissionStatementItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId: pid } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId: pid } });

  // Everything FK-ing the partner's users must die before the users themselves.
  if (userIds.length) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.savedView.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.studentBridgeGrant.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.comment.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationManager.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
  }
  await prisma.notification.deleteMany({ where: { partnerId: pid } });
  await prisma.partnerUser.deleteMany({ where: { partnerId: pid } });
  await prisma.user.deleteMany({ where: { partnerId: pid } });

  if (orgIds.length) {
    await prisma.notification.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organizationManager.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgIds } } });
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
    select: { id: true },
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
    data: { name: 'OneCSyncTestPartner', slug: PARTNER_SLUG, commissionRate: 0.1 },
  });
  partnerId = partner.id;
});

afterAll(async () => {
  await prisma.syncLog.deleteMany({
    where: { entity: { in: ['organization', 'order', 'payment', 'document'] } },
  });
  await prisma.syncState.deleteMany({});
  await deletePartnerCascade(partnerId);
  resetOneCAdapter();
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Every test starts from an empty cursor → full pull → existing assertions hold.
  // The one incremental test below clears once then runs the processor twice itself.
  await prisma.syncState.deleteMany({});
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
      select: { partnerId: true, companyId: true, inn: true },
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
      where: { externalId: { in: FAKE_ORG_EXTERNAL_IDS } },
    });
    expect(count).toBe(FAKE_ORGS.length);
  });

  it('does not overwrite partnerId on update (cabinet-owned)', async () => {
    const otherPartner = await prisma.partner.create({
      data: { name: 'OtherPartner-' + Date.now(), commissionRate: 0.05 },
    });
    await prisma.organization.updateMany({
      where: { externalId: FAKE_ORG_EXTERNAL_IDS[0] },
      data: { partnerId: otherPartner.id },
    });

    await syncOrganizationsProcessor(job(), prisma);

    const reread = await prisma.organization.findUnique({
      where: { externalId: FAKE_ORG_EXTERNAL_IDS[0] },
      select: { partnerId: true },
    });
    expect(reread?.partnerId).toBe(otherPartner.id);

    await prisma.organization.updateMany({
      where: { externalId: FAKE_ORG_EXTERNAL_IDS[0] },
      data: { partnerId },
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
      select: { partnerId: true, companyId: true, executionStatus: true },
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
      where: { externalId: { in: FAKE_ORDER_EXTERNAL_IDS } },
    });
    expect(count).toBe(FAKE_ORDERS.length);
  });

  it('does not overwrite executionStatus on update (cabinet-owned)', async () => {
    await prisma.order.updateMany({
      where: { externalId: FAKE_ORDER_EXTERNAL_IDS[0] },
      data: { executionStatus: 'on_hold' },
    });

    await syncOrdersProcessor(job(), prisma);

    const reread = await prisma.order.findUnique({
      where: { externalId: FAKE_ORDER_EXTERNAL_IDS[0] },
      select: { executionStatus: true },
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
      select: { externalId: true, organizationId: true },
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
          select: { id: true, externalId: true },
        })
      ).map((o) => [o.externalId, o.id])
    );
    const orderByExt = new Map(orders.map((o) => [o.externalId, o.organizationId]));
    for (const fakeOrder of FAKE_ORDERS) {
      const expectedOrgId = orgByExt.get(fakeOrder.organizationExternalId!);
      expect(orderByExt.get(fakeOrder.externalId)).toBe(expectedOrgId);
    }
  });

  // Note: "backfills Order.organizationId when existing record has null" test
  // removed — after migration 20260526132950_order_organization_id_required the
  // column is NOT NULL at the DB level, so the legacy-null scenario is unreachable.

  it('does not overwrite existing non-null Order.organizationId', async () => {
    const target = FAKE_ORDER_EXTERNAL_IDS[0];

    // create alternate organization linked to same partner
    const altCompany = await prisma.company.create({
      data: { name: 'AltCompany-' + Date.now() },
    });
    const altOrg = await prisma.organization.create({
      data: {
        name: 'AltOrg-' + Date.now(),
        partnerId,
        companyId: altCompany.id,
      },
    });

    // assign order to alt org manually
    await prisma.order.updateMany({
      where: { externalId: target },
      data: { organizationId: altOrg.id },
    });

    await syncOrdersProcessor(job(), prisma);

    const after = await prisma.order.findUnique({
      where: { externalId: target },
      select: { organizationId: true },
    });
    expect(after?.organizationId).toBe(altOrg.id);

    // restore: re-link to real org (matches fixture organizationExternalId).
    // В DTO поле опционально, но у фикстуры [0] оно всегда задано — отсюда `!`
    // (без него exactOptionalPropertyTypes не пустит `string | undefined` в
    // OrganizationWhereUniqueInput).
    const realOrg = await prisma.organization.findUnique({
      where: { externalId: FAKE_ORDERS[0].organizationExternalId! },
      select: { id: true },
    });
    await prisma.order.updateMany({
      where: { externalId: target },
      data: { organizationId: realOrg!.id },
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
      orderBy: { createdAt: 'desc' },
    });
    expect(lastLog?.status).toBe('warn');

    await syncOrganizationsProcessor(job(), prisma);
  });

  it('advances the cursor so a re-run only re-pulls within the 5-min overlap window', async () => {
    process.env.ONE_C_CURSOR_OVERLAP_MINUTES = '5';
    await cleanupDocs();
    await cleanupPayments();
    await cleanupOrders();
    await prisma.syncState.deleteMany({});

    const first = await syncOrdersProcessor(job(), prisma);
    expect(first.created).toBe(FAKE_ORDERS.length);

    // Second run WITHOUT clearing the cursor: only orders with updatedAt within
    // 5 min of the max watermark are re-pulled. FAKE_ORDERS have distinct, days-apart
    // updatedAt, so exactly the newest one falls inside the overlap window.
    const second = await syncOrdersProcessor(job(), prisma);
    expect(second.pulled).toBe(1);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);

    delete process.env.ONE_C_CURSOR_OVERLAP_MINUTES;
    await prisma.syncState.deleteMany({});
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
      select: { orderId: true, amount: true },
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
      where: { externalId: { in: FAKE_PAYMENT_EXTERNAL_IDS } },
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
      select: { type: true, direction: true, generatedBy: true, path: true },
    });
    expect(docs).toHaveLength(FAKE_DOCUMENTS.length);
    for (const d of docs) {
      expect(d.direction).toBe('incoming');
      expect(d.generatedBy).toBe('system');
      // DOC-03: path is now an object storage (S3) key, never the external 1C URL.
      expect(d.path).toMatch(/^orders\//);
      expect(d.path).not.toMatch(/^fake:\/\//);
    }
    expect(docs.map((d) => d.type).sort()).toEqual(['act', 'contract', 'invoice']);
  });

  it('is idempotent on second run', async () => {
    const result = await syncDocumentsProcessor(job(), prisma);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(FAKE_DOCUMENTS.length);

    const count = await prisma.document.count({
      where: { externalId: { in: FAKE_DOC_EXTERNAL_IDS } },
    });
    expect(count).toBe(FAKE_DOCUMENTS.length);
  });
});
