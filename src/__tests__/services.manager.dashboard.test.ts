import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { kpis, recentEvents } from '@/lib/services/manager/dashboard';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;

let companyId: string;
let partnerId: string;
let foreignPartnerId: string;
let managedOrgId: string;
let foreignOrgId: string;
let managerUserId: string;
let orgUserId: string;
let assignmentlessManagerUserId: string;

function managerSession(userId: string, managedOrgIds: string[]): SessionPayload {
  return { sub: userId, role: 'manager', managedOrgIds };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const company = await prisma.company.create({ data: { name: `MgrDashC-${stamp}` } });
  companyId = company.id;

  const partner = await prisma.partner.create({
    data: { name: `MgrDashP-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;
  const foreignPartner = await prisma.partner.create({
    data: { name: `MgrDashFP-${stamp}`, commissionRate: 0.1 },
  });
  foreignPartnerId = foreignPartner.id;

  const managedOrg = await prisma.organization.create({
    data: { name: `MgrDashOrg-${stamp}`, partnerId, companyId },
  });
  managedOrgId = managedOrg.id;
  const foreignOrg = await prisma.organization.create({
    data: { name: `MgrDashForeignOrg-${stamp}`, partnerId: foreignPartnerId, companyId },
  });
  foreignOrgId = foreignOrg.id;

  const manager = await prisma.user.create({
    data: {
      email: `mgr-dash-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager Dash',
      role: 'manager',
    },
  });
  managerUserId = manager.id;

  const orgUser = await prisma.user.create({
    data: {
      email: `org-user-dash-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Org User Dash',
      role: 'organization',
      organizationId: managedOrgId,
    },
  });
  orgUserId = orgUser.id;

  const noAssignManager = await prisma.user.create({
    data: {
      email: `mgr-noassign-dash-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'No-Assignment Manager',
      role: 'manager',
    },
  });
  assignmentlessManagerUserId = noAssignManager.id;

  await prisma.organizationManager.create({
    data: { organizationId: managedOrgId, userId: managerUserId, isActive: true },
  });
});

afterAll(async () => {
  // FK-walk cleanup: comments → documents → payments → orders → ...
  await prisma.notification.deleteMany({
    where: { userId: { in: [managerUserId, orgUserId, assignmentlessManagerUserId] } },
  });
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [managerUserId, orgUserId, assignmentlessManagerUserId] } },
  });
  await prisma.comment.deleteMany({
    where: { author: { id: { in: [managerUserId, orgUserId, assignmentlessManagerUserId] } } },
  });
  await prisma.payment.deleteMany({
    where: { order: { organizationId: { in: [managedOrgId, foreignOrgId] } } },
  });
  await prisma.document.deleteMany({
    where: { order: { organizationId: { in: [managedOrgId, foreignOrgId] } } },
  });
  await prisma.order.deleteMany({
    where: { organizationId: { in: [managedOrgId, foreignOrgId] } },
  });
  await prisma.organizationManager.deleteMany({ where: { userId: managerUserId } });
  await prisma.user.deleteMany({
    where: { id: { in: [managerUserId, orgUserId, assignmentlessManagerUserId] } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: [managedOrgId, foreignOrgId] } } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerId, foreignPartnerId] } } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('manager dashboard service — kpis', () => {
  it('returns all zeros for an assignmentless manager and empty DB scope', async () => {
    const session = managerSession(assignmentlessManagerUserId, []);
    const k = await kpis(prisma, session);
    expect(k).toEqual({
      activeOrders: 0,
      attentionCount: 0,
      unreadComments: 0,
      urgentDeadlines: 0,
    });
  });

  it('counts active orders only within scope (per-org)', async () => {
    const now = Date.now();
    await prisma.order.create({
      data: {
        title: `MgrDash-A1-${now}`,
        orderNumber: `MDK-A1-${now}`,
        companyId,
        partnerId,
        organizationId: managedOrgId,
        executionStatus: 'in_progress',
      },
    });
    await prisma.order.create({
      data: {
        title: `MgrDash-A2-${now}`,
        orderNumber: `MDK-A2-${now}`,
        companyId,
        partnerId,
        organizationId: managedOrgId,
        executionStatus: 'pending',
      },
    });
    // out-of-scope order in foreign org
    await prisma.order.create({
      data: {
        title: `MgrDash-F1-${now}`,
        orderNumber: `MDK-F1-${now}`,
        companyId,
        partnerId: foreignPartnerId,
        organizationId: foreignOrgId,
        executionStatus: 'in_progress',
      },
    });

    const session = managerSession(managerUserId, [managedOrgId]);
    const k = await kpis(prisma, session);
    expect(k.activeOrders).toBe(2);
  });

  it('counts urgent deadlines (deadline within next 3 days)', async () => {
    const now = Date.now();
    const inTwoDays = new Date(now + 2 * 24 * 3600 * 1000);
    const inTenDays = new Date(now + 10 * 24 * 3600 * 1000);
    await prisma.order.create({
      data: {
        title: `MgrDash-Urg1-${now}`,
        orderNumber: `MDK-U1-${now}`,
        companyId,
        partnerId,
        organizationId: managedOrgId,
        executionStatus: 'in_progress',
        deadline: inTwoDays,
      },
    });
    await prisma.order.create({
      data: {
        title: `MgrDash-Far1-${now}`,
        orderNumber: `MDK-Far1-${now}`,
        companyId,
        partnerId,
        organizationId: managedOrgId,
        executionStatus: 'in_progress',
        deadline: inTenDays,
      },
    });

    const session = managerSession(managerUserId, [managedOrgId]);
    const k = await kpis(prisma, session);
    expect(k.urgentDeadlines).toBeGreaterThanOrEqual(1);
  });

  it('counts attentionCount for overdue orders, excluding completed', async () => {
    const now = Date.now();
    const yesterday = new Date(now - 24 * 3600 * 1000);
    const overdueOrder = await prisma.order.create({
      data: {
        title: `MgrDash-OD-${now}`,
        orderNumber: `MDK-OD-${now}`,
        companyId,
        partnerId,
        organizationId: managedOrgId,
        executionStatus: 'in_progress',
        deadline: yesterday,
      },
    });
    // overdue but completed → must NOT count
    await prisma.order.create({
      data: {
        title: `MgrDash-ODC-${now}`,
        orderNumber: `MDK-ODC-${now}`,
        companyId,
        partnerId,
        organizationId: managedOrgId,
        executionStatus: 'completed',
        deadline: yesterday,
      },
    });

    const session = managerSession(managerUserId, [managedOrgId]);
    const k = await kpis(prisma, session);
    expect(k.attentionCount).toBeGreaterThanOrEqual(1);
    void overdueOrder;
  });

  it('counts unreadComments only for own notifications of type=comment_from_org', async () => {
    await prisma.notification.create({
      data: {
        userId: managerUserId,
        type: 'comment_from_org',
        title: 'New comment',
        body: 'hi from org',
        isRead: false,
      },
    });
    // read one — must not count
    await prisma.notification.create({
      data: {
        userId: managerUserId,
        type: 'comment_from_org',
        title: 'Old',
        body: 'old',
        isRead: true,
      },
    });
    // different user — must not count
    await prisma.notification.create({
      data: {
        userId: assignmentlessManagerUserId,
        type: 'comment_from_org',
        title: 'Other',
        body: 'x',
        isRead: false,
      },
    });
    // different type — must not count
    await prisma.notification.create({
      data: {
        userId: managerUserId,
        type: 'order_status_changed',
        title: 'Status',
        body: 'x',
        isRead: false,
      },
    });

    const session = managerSession(managerUserId, [managedOrgId]);
    const k = await kpis(prisma, session);
    expect(k.unreadComments).toBe(1);
  });
});

describe('manager dashboard service — recentEvents', () => {
  it('returns empty list for assignmentless manager with no scope', async () => {
    const session = managerSession(assignmentlessManagerUserId, []);
    const events = await recentEvents(prisma, session);
    expect(events).toEqual([]);
  });

  it('includes scoped documents, payments and comments and slices to take', async () => {
    const now = Date.now();
    const order = await prisma.order.create({
      data: {
        title: `Events-Order-${now}`,
        orderNumber: `EV-O-${now}`,
        companyId,
        partnerId,
        organizationId: managedOrgId,
        executionStatus: 'in_progress',
      },
    });
    const doc = await prisma.document.create({
      data: {
        name: `evdoc-${now}.pdf`,
        path: `fake://ev-${now}`,
        mimeType: 'application/pdf',
        type: 'other',
        orderId: order.id,
        companyId,
        counterpartyType: 'organization',
        counterpartyId: managedOrgId,
      },
    });
    const payment = await prisma.payment.create({
      data: { organizationId: managedOrgId, orderId: order.id, amount: 1234, paidAt: new Date() },
    });
    const comment = await prisma.comment.create({
      data: {
        orderId: order.id,
        body: 'Тестовый комментарий для events feed (длинная строка проверяющая slice 100 символов на тексте сообщения)',
        authorId: orgUserId,
      },
    });

    const session = managerSession(managerUserId, [managedOrgId]);
    const events = await recentEvents(prisma, session, 50);

    expect(events.some((e) => e.id === `doc-${doc.id}`)).toBe(true);
    expect(events.some((e) => e.id === `pay-${payment.id}`)).toBe(true);
    expect(events.some((e) => e.id === `comment-${comment.id}`)).toBe(true);

    // Sorted desc by when
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]!.when.getTime()).toBeGreaterThanOrEqual(events[i]!.when.getTime());
    }

    const sliced = await recentEvents(prisma, session, 1);
    expect(sliced).toHaveLength(1);
  });

  it('excludes events for orders outside scope', async () => {
    const now = Date.now();
    const foreignOrder = await prisma.order.create({
      data: {
        title: `Events-Foreign-${now}`,
        orderNumber: `EV-F-${now}`,
        companyId,
        partnerId: foreignPartnerId,
        organizationId: foreignOrgId,
        executionStatus: 'in_progress',
      },
    });
    const foreignPayment = await prisma.payment.create({
      data: {
        organizationId: foreignOrgId,
        orderId: foreignOrder.id,
        amount: 999,
        paidAt: new Date(),
      },
    });

    const session = managerSession(managerUserId, [managedOrgId]);
    const events = await recentEvents(prisma, session, 50);
    expect(events.some((e) => e.id === `pay-${foreignPayment.id}`)).toBe(false);
  });
});
