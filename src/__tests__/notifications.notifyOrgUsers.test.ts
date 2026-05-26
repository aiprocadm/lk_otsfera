import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { notifyOrgUsers } from '@/lib/notifications';

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgAId: string;
let orgBId: string;
let activeMember1Id: string;
let activeMember2Id: string;
let deactivatedMemberId: string;
let inactiveUserMemberId: string;
let orderId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const partner = await prisma.partner.create({
    data: { name: `NotifyOrgP-${stamp}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `NotifyOrgC-${stamp}` } });
  companyId = company.id;

  const orgA = await prisma.organization.create({
    data: { name: `NotifyOrgA-${stamp}`, partnerId, companyId }
  });
  const orgB = await prisma.organization.create({
    data: { name: `NotifyOrgB-${stamp}`, partnerId, companyId }
  });
  orgAId = orgA.id;
  orgBId = orgB.id;

  const order = await prisma.order.create({
    data: {
      title: 'NotifyOrg-Test',
      companyId,
      partnerId,
      organizationId: orgAId,
      executionStatus: 'in_progress'
    }
  });
  orderId = order.id;

  const u1 = await prisma.user.create({
    data: { email: `notify1-${stamp}@t.local`, name: 'Active 1', role: 'organization' }
  });
  const u2 = await prisma.user.create({
    data: { email: `notify2-${stamp}@t.local`, name: 'Active 2', role: 'organization' }
  });
  const uDeact = await prisma.user.create({
    data: { email: `notify3-${stamp}@t.local`, name: 'Deactivated Member', role: 'organization' }
  });
  const uInactiveUser = await prisma.user.create({
    data: {
      email: `notify4-${stamp}@t.local`,
      name: 'Inactive User',
      role: 'organization',
      isActive: false
    }
  });
  activeMember1Id = u1.id;
  activeMember2Id = u2.id;
  deactivatedMemberId = uDeact.id;
  inactiveUserMemberId = uInactiveUser.id;

  await prisma.organizationUser.create({
    data: { organizationId: orgAId, userId: u1.id, roleInOrg: 'admin', isActive: true }
  });
  await prisma.organizationUser.create({
    data: { organizationId: orgAId, userId: u2.id, roleInOrg: 'member', isActive: true }
  });
  await prisma.organizationUser.create({
    data: { organizationId: orgAId, userId: uDeact.id, roleInOrg: 'member', isActive: false }
  });
  await prisma.organizationUser.create({
    data: {
      organizationId: orgAId,
      userId: uInactiveUser.id,
      roleInOrg: 'member',
      isActive: true
    }
  });
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: { organizationId: { in: [orgAId, orgBId].filter(Boolean) } }
  });
  await prisma.organizationUser.deleteMany({ where: { organizationId: orgAId } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [activeMember1Id, activeMember2Id, deactivatedMemberId, inactiveUserMemberId].filter(
          Boolean
        )
      }
    }
  });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clear notifications between tests to keep assertions isolated.
  await prisma.notification.deleteMany({
    where: { organizationId: { in: [orgAId, orgBId] } }
  });
  // Email is implicitly off in test env (no EMAIL_ENABLED), so send() returns
  // 'skipped:disabled' — that's the path we exercise here.
  delete process.env.EMAIL_ENABLED;
});

describe('notifyOrgUsers', () => {
  it('creates notification per active member only', async () => {
    const summary = await notifyOrgUsers(prisma, {
      organizationId: orgAId,
      type: 'payment_received',
      payload: {
        orderId,
        orderNumber: 'ORD-001',
        orderTitle: 'NotifyOrg-Test',
        amount: '12345.00',
        paidAt: new Date('2026-05-26T10:00:00Z')
      }
    });

    expect(summary.recipientsNotified).toBe(2);
    expect(summary.emailsSent).toBe(0);
    expect(summary.emailsSkipped).toBe(2);

    const notifications = await prisma.notification.findMany({
      where: { organizationId: orgAId },
      orderBy: { createdAt: 'asc' }
    });
    expect(notifications).toHaveLength(2);

    const userIds = notifications.map((n) => n.userId).sort();
    expect(userIds).toEqual([activeMember1Id, activeMember2Id].sort());

    const n = notifications[0];
    expect(n.type).toBe('payment_received');
    expect(n.title).toContain('ORD-001');
    expect(n.body).toContain('12345.00');
    expect(n.organizationId).toBe(orgAId);
    const meta = n.meta as Record<string, unknown>;
    expect(meta.orderId).toBe(orderId);
    expect(meta.amount).toBe('12345.00');
    expect(meta.organizationName).toContain('NotifyOrgA');
    expect(meta.url).toContain(`/organization/orders/${orderId}`);
  });

  it('formats document_published title and body', async () => {
    const summary = await notifyOrgUsers(prisma, {
      organizationId: orgAId,
      type: 'document_published',
      payload: {
        orderId,
        orderNumber: 'ORD-002',
        orderTitle: 'NotifyOrg-Test',
        documentName: 'contract.pdf',
        documentType: 'contract'
      }
    });
    expect(summary.recipientsNotified).toBe(2);

    const n = await prisma.notification.findFirst({
      where: { organizationId: orgAId, type: 'document_published' }
    });
    expect(n).not.toBeNull();
    expect(n!.title).toContain('ORD-002');
    expect(n!.body).toContain('contract.pdf');
    expect(n!.body).toContain('contract');
  });

  it('formats order_status_changed with old → new status', async () => {
    const summary = await notifyOrgUsers(prisma, {
      organizationId: orgAId,
      type: 'order_status_changed',
      payload: {
        orderId,
        orderNumber: 'ORD-003',
        orderTitle: 'NotifyOrg-Test',
        dimension: 'execution',
        oldStatus: 'pending',
        newStatus: 'in_progress'
      }
    });
    expect(summary.recipientsNotified).toBe(2);

    const n = await prisma.notification.findFirst({
      where: { organizationId: orgAId, type: 'order_status_changed' }
    });
    expect(n).not.toBeNull();
    expect(n!.title).toContain('Статус');
    expect(n!.title).toContain('ORD-003');
    expect(n!.body).toContain('pending');
    expect(n!.body).toContain('in_progress');
  });

  it('returns zero summary and creates nothing when organization does not exist', async () => {
    const summary = await notifyOrgUsers(prisma, {
      organizationId: 'org-does-not-exist',
      type: 'payment_received',
      payload: {
        orderId,
        orderNumber: 'X',
        orderTitle: 'X',
        amount: '0',
        paidAt: new Date()
      }
    });
    expect(summary).toEqual({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
  });

  it('returns zero recipients when org has no active members', async () => {
    // orgB has no memberships at all
    const summary = await notifyOrgUsers(prisma, {
      organizationId: orgBId,
      type: 'payment_received',
      payload: {
        orderId,
        orderNumber: 'X',
        orderTitle: 'X',
        amount: '0',
        paidAt: new Date()
      }
    });
    expect(summary.recipientsNotified).toBe(0);
    expect(summary.emailsSent).toBe(0);
    expect(summary.emailsSkipped).toBe(0);
  });
});
