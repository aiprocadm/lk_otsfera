import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushResult,
  OneCAdapter,
} from '@/lib/services/oneCSync';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

// DOC-03: the document writer fetches the 1C file into object storage (S3); fixtures use
// unfetchable URLs, so stub the fetch-store to return a deterministic storage key.
vi.mock('@/lib/services/oneCSync/document-fetch', () => ({
  fetchAndStore1CDocument: vi.fn(
    async (a: { orderId: string; name: string }) => `orders/${a.orderId}/1c/stored-${a.name}`
  ),
}));

class ScriptedAdapter implements OneCAdapter {
  public orders: OneCOrderDto[] = [];
  public payments: OneCPaymentDto[] = [];
  public documents: OneCDocumentDto[] = [];
  async pullOrganizations(): Promise<OneCOrgDto[]> {
    return [];
  }
  async pullOrders(): Promise<OneCOrderDto[]> {
    return this.orders;
  }
  async pullPayments(): Promise<OneCPaymentDto[]> {
    return this.payments;
  }
  async pullDocuments(): Promise<OneCDocumentDto[]> {
    return this.documents;
  }
  async pushLead(): Promise<OneCLeadPushResult> {
    return { acceptedAt: new Date().toISOString() };
  }
}

const adapter = new ScriptedAdapter();

vi.mock('@/lib/services/oneCSync', async (orig) => {
  const actual = await (orig() as Promise<typeof import('@/lib/services/oneCSync')>);
  return {
    ...actual,
    getOneCAdapter: () => adapter,
  };
});

import { syncPaymentsProcessor } from '@/worker/processors/sync-payments';
import { syncDocumentsProcessor } from '@/worker/processors/sync-documents';
import { syncOrdersProcessor } from '@/worker/processors/sync-orders';

function job(): Job<SyncJobPayload> {
  return {
    id: 'nh-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    data: { triggeredAt: new Date().toISOString(), reason: 'manual' as const },
  } as Job<SyncJobPayload>;
}

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgId: string;
let user1Id: string;
let user2Id: string;
let orderId: string;
let orderExternalId: string;
let orgExternalId: string;

beforeAll(async () => {
  resetOneCAdapter();
  prisma = new PrismaClient();
  const stamp = Date.now();

  const partner = await prisma.partner.create({
    data: { name: `NotifHookP-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `NotifHookC-${stamp}` } });
  companyId = company.id;

  orgExternalId = `1c-org-nh-${stamp}`;
  const org = await prisma.organization.create({
    data: {
      name: `NotifHookOrg-${stamp}`,
      partnerId,
      companyId,
      externalId: orgExternalId,
    },
  });
  orgId = org.id;

  const u1 = await prisma.user.create({
    data: { email: `nh-u1-${stamp}@t.local`, name: 'Member 1', role: 'organization' },
  });
  const u2 = await prisma.user.create({
    data: { email: `nh-u2-${stamp}@t.local`, name: 'Member 2', role: 'organization' },
  });
  user1Id = u1.id;
  user2Id = u2.id;
  await prisma.organizationUser.create({
    data: { organizationId: orgId, userId: u1.id, roleInOrg: 'admin', isActive: true },
  });
  await prisma.organizationUser.create({
    data: { organizationId: orgId, userId: u2.id, roleInOrg: 'member', isActive: true },
  });

  orderExternalId = `1c-order-nh-${stamp}`;
  const order = await prisma.order.create({
    data: {
      title: 'NotifHook Order',
      orderNumber: 'NH-001',
      companyId,
      partnerId,
      organizationId: orgId,
      externalId: orderExternalId,
      executionStatus: 'in_progress',
      financialStatus: 'not_billed',
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { orderId } });
  await prisma.document.deleteMany({ where: { orderId } });
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [user1Id, user2Id] } } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.syncLog.deleteMany({
    where: { entity: { in: ['order', 'payment', 'document'] } },
  });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  resetOneCAdapter();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { organizationId: orgId } });
  await prisma.payment.deleteMany({ where: { orderId } });
  await prisma.document.deleteMany({ where: { orderId } });
  adapter.orders = [];
  adapter.payments = [];
  adapter.documents = [];
  // reset order back to baseline statuses
  await prisma.order.update({
    where: { id: orderId },
    data: { executionStatus: 'in_progress', financialStatus: 'not_billed' },
  });
  delete process.env.EMAIL_ENABLED;
});

describe('syncPaymentsProcessor notification hook', () => {
  it('fires payment_received for new payment on org-scoped order', async () => {
    adapter.payments = [
      {
        externalId: `nh-pay-${Date.now()}`,
        orderExternalId,
        amount: 50000,
        paidAt: '2026-05-25T10:00:00Z',
        method: 'wire',
        isRefund: false,
        updatedAt: '2026-05-25T10:00:00Z',
      },
    ];

    await syncPaymentsProcessor(job(), prisma);

    const notifications = await prisma.notification.findMany({
      where: { organizationId: orgId, type: 'payment_received' },
    });
    expect(notifications).toHaveLength(2); // both members
    expect(notifications[0].title).toContain('NH-001');
  });

  it('does not fire on payment update (only on create)', async () => {
    // seed an existing payment with same externalId
    const externalId = `nh-pay-existing-${Date.now()}`;
    await prisma.payment.create({
      data: {
        externalId,
        organizationId: orgId,
        orderId,
        amount: 50000,
        paidAt: new Date(),
        isRefund: false,
      },
    });
    adapter.payments = [
      {
        externalId,
        orderExternalId,
        amount: 50000,
        paidAt: '2026-05-25T10:00:00Z',
        method: 'wire',
        isRefund: false,
        updatedAt: '2026-05-25T10:00:00Z',
      },
    ];

    await syncPaymentsProcessor(job(), prisma);

    const notifications = await prisma.notification.findMany({
      where: { organizationId: orgId, type: 'payment_received' },
    });
    expect(notifications).toHaveLength(0);
  });

  it('does not fire on refunds', async () => {
    adapter.payments = [
      {
        externalId: `nh-pay-refund-${Date.now()}`,
        orderExternalId,
        amount: 10000,
        paidAt: '2026-05-25T10:00:00Z',
        method: 'wire',
        isRefund: true,
        updatedAt: '2026-05-25T10:00:00Z',
      },
    ];

    await syncPaymentsProcessor(job(), prisma);

    const notifications = await prisma.notification.findMany({
      where: { organizationId: orgId, type: 'payment_received' },
    });
    expect(notifications).toHaveLength(0);
  });
});

describe('syncDocumentsProcessor notification hook', () => {
  it('fires document_published for new document on org-scoped order', async () => {
    adapter.documents = [
      {
        externalId: `nh-doc-${Date.now()}`,
        orderExternalId,
        type: 'contract',
        name: 'NH Contract.pdf',
        mimeType: 'application/pdf',
        size: 1000,
        downloadUrl: 'fake://nh-doc-1.pdf',
        updatedAt: '2026-05-25T10:00:00Z',
      },
    ];

    await syncDocumentsProcessor(job(), prisma);

    const notifications = await prisma.notification.findMany({
      where: { organizationId: orgId, type: 'document_published' },
    });
    expect(notifications).toHaveLength(2);
    const meta = notifications[0].meta as Record<string, unknown>;
    expect(meta.documentName).toBe('NH Contract.pdf');
    expect(meta.documentType).toBe('contract');
  });

  it('does not fire on document update', async () => {
    const externalId = `nh-doc-existing-${Date.now()}`;
    await prisma.document.create({
      data: {
        externalId,
        orderId,
        name: 'Old.pdf',
        path: 'fake://old',
        mimeType: 'application/pdf',
        type: 'contract',
        direction: 'incoming',
        generatedBy: 'system',
        counterpartyType: 'organization',
        counterpartyId: orgId,
      },
    });
    adapter.documents = [
      {
        externalId,
        orderExternalId,
        type: 'contract',
        name: 'Old.pdf',
        mimeType: 'application/pdf',
        size: 1000,
        downloadUrl: 'fake://old.pdf',
        updatedAt: '2026-05-25T10:00:00Z',
      },
    ];

    await syncDocumentsProcessor(job(), prisma);

    const notifications = await prisma.notification.findMany({
      where: { organizationId: orgId, type: 'document_published' },
    });
    expect(notifications).toHaveLength(0);
  });
});

describe('syncOrdersProcessor notification hook', () => {
  it('fires order_status_changed when financialStatus diff on update', async () => {
    // baseline order has financialStatus='not_billed'; DTO has 'paid'
    adapter.orders = [
      {
        externalId: orderExternalId,
        orderNumber: 'NH-001',
        title: 'NotifHook Order',
        organizationExternalId: orgExternalId,
        totalAmount: 100000,
        paidAmount: 100000,
        vatIncluded: true,
        executionStatus: 'in_progress',
        financialStatus: 'paid',
        productMix: [],
        updatedAt: '2026-05-25T10:00:00Z',
      },
    ];

    await syncOrdersProcessor(job(), prisma);

    const notifications = await prisma.notification.findMany({
      where: { organizationId: orgId, type: 'order_status_changed' },
    });
    expect(notifications).toHaveLength(2);
    const meta = notifications[0].meta as Record<string, unknown>;
    expect(meta.dimension).toBe('financial');
    expect(meta.oldStatus).toBe('not_billed');
    expect(meta.newStatus).toBe('paid');
  });

  it('does not fire when financialStatus unchanged', async () => {
    adapter.orders = [
      {
        externalId: orderExternalId,
        orderNumber: 'NH-001',
        title: 'NotifHook Order',
        organizationExternalId: orgExternalId,
        totalAmount: 100000,
        paidAmount: 0,
        vatIncluded: true,
        executionStatus: 'in_progress',
        financialStatus: 'not_billed', // same as baseline
        productMix: [],
        updatedAt: '2026-05-25T10:00:00Z',
      },
    ];

    await syncOrdersProcessor(job(), prisma);

    const notifications = await prisma.notification.findMany({
      where: { organizationId: orgId, type: 'order_status_changed' },
    });
    expect(notifications).toHaveLength(0);
  });
});
