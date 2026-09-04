import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type {
  OneCOrgDto,
  OneCOrderDto,
  OneCPaymentDto,
  OneCDocumentDto,
  OneCLeadPushResult,
  OneCDocumentPushResult,
  OneCAdapter,
} from '@/lib/services/oneCSync';
import { resetOneCAdapter } from '@/lib/services/oneCSync';
import type { SyncJobPayload } from '@/lib/jobs/types';

// Task 29 — `syncPaymentsProcessor` must fan out to the manager cabinet
// via `notifyManagers({ type: 'order_marked_paid_by_1c' })` on each newly
// created (non-refund) payment, alongside the existing `notifyOrgUsers`
// hook. Failure of the manager fan-out must NOT cause the worker job to
// throw — the in-app row and the audit log are the source of truth, the
// email is a side channel.

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
  async pushDocument(): Promise<OneCDocumentPushResult> {
    return { externalId: '1c-doc-scripted' };
  }
  async findDocument(): Promise<OneCDocumentDto | null> {
    return null;
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

// notifyManagers is the unit under test — wrap the real implementation in a
// spy so we can both (a) assert it was called with the right shape and
// (b) verify Notification rows for managers actually land in the DB.
const notifyManagersSpy = vi.fn();
vi.mock('@/lib/notifications', async (orig) => {
  const actual = await (orig() as Promise<typeof import('@/lib/notifications')>);
  return {
    ...actual,
    notifyManagers: (...args: Parameters<typeof actual.notifyManagers>) => {
      notifyManagersSpy(...args);
      return actual.notifyManagers(...args);
    },
  };
});

import { syncPaymentsProcessor } from '@/worker/processors/sync-payments';

function makeJob(): Job<SyncJobPayload> {
  return {
    id: 'spm-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    data: { triggeredAt: new Date().toISOString(), reason: 'manual' as const },
  } as Job<SyncJobPayload>;
}

const STAMP = Date.now();
const uniq = (label: string) => `sync-pay-mgr-${label}-${STAMP}`;

let prisma: PrismaClient;

let partnerId: string;
let companyId: string;
let orgWithManagerId: string;
let orgNoManagerId: string;

let perOrderManagerId: string;
let orgManagerId: string;
let orgUserId: string; // org member, gets payment_received via notifyOrgUsers

let orderPerOrderManagerId: string;
let orderPerOrgManagerId: string;
let orderNoManagerId: string;

let orderPerOrderExternalId: string;
let orderPerOrgExternalId: string;
let orderNoManagerExternalId: string;

beforeAll(async () => {
  resetOneCAdapter();
  prisma = new PrismaClient();

  const partner = await prisma.partner.create({
    data: { name: uniq('p'), commissionRate: 0.1 },
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: uniq('co') } });
  companyId = company.id;

  // Two organizations: one with an active OrganizationManager, one with none.
  const orgA = await prisma.organization.create({
    data: { name: uniq('org-with-mgr'), partnerId, companyId, externalId: uniq('1c-org-a') },
  });
  orgWithManagerId = orgA.id;
  const orgB = await prisma.organization.create({
    data: {
      name: uniq('org-no-mgr'),
      partnerId,
      companyId,
      externalId: uniq('1c-org-b'),
    },
  });
  orgNoManagerId = orgB.id;

  // Managers
  const perOrderM = await prisma.user.create({
    data: {
      email: `${uniq('m-per-order')}@t.local`,
      name: 'M-Per-Order',
      role: 'manager',
    },
  });
  perOrderManagerId = perOrderM.id;

  const orgM = await prisma.user.create({
    data: { email: `${uniq('m-org')}@t.local`, name: 'M-Org', role: 'manager' },
  });
  orgManagerId = orgM.id;

  // Org user (so notifyOrgUsers has someone to write to — confirms we
  // don't regress the existing fan-out)
  const orgU = await prisma.user.create({
    data: { email: `${uniq('u-org')}@t.local`, name: 'OrgUser', role: 'organization' },
  });
  orgUserId = orgU.id;
  await prisma.organizationUser.create({
    data: {
      organizationId: orgWithManagerId,
      userId: orgUserId,
      roleInOrg: 'admin',
      isActive: true,
    },
  });
  await prisma.organizationUser.create({
    data: { organizationId: orgNoManagerId, userId: orgUserId, roleInOrg: 'admin', isActive: true },
  });

  // Per-org assignment for orgA only
  await prisma.organizationManager.create({
    data: { organizationId: orgWithManagerId, userId: orgManagerId, isActive: true },
  });

  // ----- Orders ------------------------------------------------------------
  // 1) order with explicit managerId (perOrderManagerId), on orgB (no per-org)
  orderPerOrderExternalId = uniq('1c-ord-per-order');
  const o1 = await prisma.order.create({
    data: {
      title: uniq('ord-per-order'),
      orderNumber: 'SPM-001',
      companyId,
      partnerId,
      organizationId: orgNoManagerId,
      externalId: orderPerOrderExternalId,
      managerId: perOrderManagerId,
      executionStatus: 'in_progress',
      financialStatus: 'not_billed',
    },
  });
  orderPerOrderManagerId = o1.id;

  // 2) order without explicit managerId, on orgA (per-org assignment present)
  orderPerOrgExternalId = uniq('1c-ord-per-org');
  const o2 = await prisma.order.create({
    data: {
      title: uniq('ord-per-org'),
      orderNumber: 'SPM-002',
      companyId,
      partnerId,
      organizationId: orgWithManagerId,
      externalId: orderPerOrgExternalId,
      executionStatus: 'in_progress',
      financialStatus: 'not_billed',
    },
  });
  orderPerOrgManagerId = o2.id;

  // 3) order without any manager linkage (no managerId, on orgB)
  orderNoManagerExternalId = uniq('1c-ord-no-mgr');
  const o3 = await prisma.order.create({
    data: {
      title: uniq('ord-no-mgr'),
      orderNumber: 'SPM-003',
      companyId,
      partnerId,
      organizationId: orgNoManagerId,
      externalId: orderNoManagerExternalId,
      executionStatus: 'in_progress',
      financialStatus: 'not_billed',
    },
  });
  orderNoManagerId = o3.id;
});

afterAll(async () => {
  const orderIds = [orderPerOrderManagerId, orderPerOrgManagerId, orderNoManagerId].filter(Boolean);
  const userIds = [perOrderManagerId, orgManagerId, orgUserId].filter(Boolean);
  const orgIds = [orgWithManagerId, orgNoManagerId].filter(Boolean);

  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.notification.deleteMany({
    where: {
      OR: [{ userId: { in: userIds } }, { organizationId: { in: orgIds } }],
    },
  });
  await prisma.organizationManager.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.syncLog.deleteMany({ where: { entity: 'payment' } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  resetOneCAdapter();
  await prisma.$disconnect();
});

beforeEach(async () => {
  notifyManagersSpy.mockClear();
  adapter.orders = [];
  adapter.payments = [];
  adapter.documents = [];
  await prisma.payment.deleteMany({
    where: { orderId: { in: [orderPerOrderManagerId, orderPerOrgManagerId, orderNoManagerId] } },
  });
  await prisma.notification.deleteMany({
    where: {
      OR: [
        { userId: { in: [perOrderManagerId, orgManagerId, orgUserId] } },
        { organizationId: { in: [orgWithManagerId, orgNoManagerId] } },
      ],
    },
  });
  delete process.env.EMAIL_ENABLED;
});

describe('syncPaymentsProcessor → notifyManagers fan-out', () => {
  it('calls notifyManagers once with order_marked_paid_by_1c payload when order has managerId', async () => {
    const paidAtIso = '2026-05-26T10:00:00.000Z';
    adapter.payments = [
      {
        externalId: uniq('pay-per-order'),
        orderExternalId: orderPerOrderExternalId,
        amount: 75000,
        paidAt: paidAtIso,
        method: 'wire',
        isRefund: false,
        updatedAt: paidAtIso,
      },
    ];

    await syncPaymentsProcessor(makeJob(), prisma);

    expect(notifyManagersSpy).toHaveBeenCalledTimes(1);
    expect(notifyManagersSpy).toHaveBeenCalledWith(expect.anything(), {
      orderId: orderPerOrderManagerId,
      type: 'order_marked_paid_by_1c',
      payload: {
        amount: 75000,
        paidAt: new Date(paidAtIso),
      },
    });

    // The per-order manager got an in-app row.
    const mgrRows = await prisma.notification.findMany({
      where: { userId: perOrderManagerId, type: 'order_marked_paid_by_1c' },
    });
    expect(mgrRows).toHaveLength(1);
    const meta = mgrRows[0].meta as Record<string, unknown>;
    expect(meta.orderId).toBe(orderPerOrderManagerId);
    expect(meta.amount).toBe(75000);
    expect(meta.paidAt).toBe(paidAtIso);

    // Existing org-side fan-out continues to work — no regression.
    const orgRows = await prisma.notification.findMany({
      where: { userId: orgUserId, type: 'payment_received' },
    });
    expect(orgRows).toHaveLength(1);
  });

  it('routes to per-org managers when order.managerId is null but OrganizationManager exists', async () => {
    const paidAtIso = '2026-05-26T11:00:00.000Z';
    adapter.payments = [
      {
        externalId: uniq('pay-per-org'),
        orderExternalId: orderPerOrgExternalId,
        amount: 42000,
        paidAt: paidAtIso,
        method: 'card',
        isRefund: false,
        updatedAt: paidAtIso,
      },
    ];

    await syncPaymentsProcessor(makeJob(), prisma);

    expect(notifyManagersSpy).toHaveBeenCalledTimes(1);
    expect(notifyManagersSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orderId: orderPerOrgManagerId,
        type: 'order_marked_paid_by_1c',
        payload: expect.objectContaining({ amount: 42000 }),
      })
    );

    // Per-org manager got the row even though there is no Order.managerId.
    const mgrRows = await prisma.notification.findMany({
      where: { userId: orgManagerId, type: 'order_marked_paid_by_1c' },
    });
    expect(mgrRows).toHaveLength(1);

    // The per-order-only manager should NOT have been notified for this order.
    const wrongMgrRows = await prisma.notification.findMany({
      where: { userId: perOrderManagerId, type: 'order_marked_paid_by_1c' },
    });
    expect(wrongMgrRows).toHaveLength(0);
  });

  it('still calls notifyManagers (recipients=0) when the order has no manager linkage', async () => {
    const paidAtIso = '2026-05-26T12:00:00.000Z';
    adapter.payments = [
      {
        externalId: uniq('pay-no-mgr'),
        orderExternalId: orderNoManagerExternalId,
        amount: 10000,
        paidAt: paidAtIso,
        method: 'wire',
        isRefund: false,
        updatedAt: paidAtIso,
      },
    ];

    await expect(syncPaymentsProcessor(makeJob(), prisma)).resolves.toMatchObject({
      created: 1,
    });

    // Hook fired once with the no-manager order id, but no manager rows landed.
    expect(notifyManagersSpy).toHaveBeenCalledTimes(1);
    expect(notifyManagersSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: orderNoManagerId, type: 'order_marked_paid_by_1c' })
    );
    const mgrRows = await prisma.notification.findMany({
      where: {
        type: 'order_marked_paid_by_1c',
        userId: { in: [perOrderManagerId, orgManagerId] },
      },
    });
    expect(mgrRows).toHaveLength(0);
  });

  it('does NOT call notifyManagers for refunds (mirrors notifyOrgUsers gating)', async () => {
    adapter.payments = [
      {
        externalId: uniq('pay-refund'),
        orderExternalId: orderPerOrderExternalId,
        amount: 5000,
        paidAt: '2026-05-26T13:00:00.000Z',
        method: 'wire',
        isRefund: true,
        updatedAt: '2026-05-26T13:00:00.000Z',
      },
    ];

    await syncPaymentsProcessor(makeJob(), prisma);

    expect(notifyManagersSpy).not.toHaveBeenCalled();
    const mgrRows = await prisma.notification.findMany({
      where: {
        type: 'order_marked_paid_by_1c',
        userId: { in: [perOrderManagerId, orgManagerId] },
      },
    });
    expect(mgrRows).toHaveLength(0);
  });

  it('does NOT call notifyManagers on payment update (only on create)', async () => {
    const externalId = uniq('pay-existing');
    await prisma.payment.create({
      data: {
        externalId,
        organizationId: orgNoManagerId,
        orderId: orderPerOrderManagerId,
        amount: 50000,
        paidAt: new Date('2026-05-25T10:00:00.000Z'),
        isRefund: false,
      },
    });
    adapter.payments = [
      {
        externalId,
        orderExternalId: orderPerOrderExternalId,
        amount: 99999, // different — would-be update
        paidAt: '2026-05-26T14:00:00.000Z',
        method: 'wire',
        isRefund: false,
        updatedAt: '2026-05-26T14:00:00.000Z',
      },
    ];

    await syncPaymentsProcessor(makeJob(), prisma);

    expect(notifyManagersSpy).not.toHaveBeenCalled();
    const mgrRows = await prisma.notification.findMany({
      where: {
        type: 'order_marked_paid_by_1c',
        userId: { in: [perOrderManagerId, orgManagerId] },
      },
    });
    expect(mgrRows).toHaveLength(0);
  });
});
