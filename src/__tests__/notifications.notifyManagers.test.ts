import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { notifyManagers, resolveManagerRecipients } from '@/lib/notifications';

// Live-Postgres integration test for the manager fan-out helper.
//
// Each scenario builds its own order so recipient-resolution paths stay
// isolated. Email is implicitly off in CI (no EMAIL_ENABLED), so send()
// returns 'skipped:disabled' — Notification rows still get created
// regardless. We assert that explicitly in the "RESEND not configured"
// scenario.

let prisma: PrismaClient;

let companyId: string;
let partnerId: string;
let orgAId: string;
let orgBId: string;

let perOrderManagerId: string;
let orgManager1Id: string;
let orgManager2Id: string;
let deactivatedAssignmentManagerId: string;
let historicalCommenterId: string;
let inactiveUserManagerId: string;
let unrelatedManagerId: string;

let orderPerOrderId: string;
let orderPerOrgId: string;
let orderHistoricalId: string;
let orderDedupeId: string;
let orderExcludeId: string;
let orderRESEndOffId: string;
let orderInactiveUserId: string;

const STAMP = Date.now();

function uniq(label: string): string {
  return `notifyMgr-${label}-${STAMP}`;
}

// All manager users this file creates. Scope "expect exactly these recipients"
// assertions to them so a notification another test file leaves behind (same
// type, different user) can't pollute an otherwise-global count.
const allManagerIds = (): string[] => [
  perOrderManagerId,
  orgManager1Id,
  orgManager2Id,
  deactivatedAssignmentManagerId,
  historicalCommenterId,
  inactiveUserManagerId,
  unrelatedManagerId,
];

beforeAll(async () => {
  prisma = new PrismaClient();

  const company = await prisma.company.create({ data: { name: uniq('co') } });
  companyId = company.id;
  const partner = await prisma.partner.create({
    data: { name: uniq('p'), commissionRate: 0.1 },
  });
  partnerId = partner.id;

  const orgA = await prisma.organization.create({
    data: { name: uniq('orgA'), partnerId, companyId },
  });
  orgAId = orgA.id;
  const orgB = await prisma.organization.create({
    data: { name: uniq('orgB'), partnerId, companyId },
  });
  orgBId = orgB.id;

  // Manager users
  const perOrderM = await prisma.user.create({
    data: { email: `${uniq('m-per-order')}@t.local`, name: 'M-Per-Order', role: 'manager' },
  });
  perOrderManagerId = perOrderM.id;

  const orgM1 = await prisma.user.create({
    data: { email: `${uniq('m-org-1')}@t.local`, name: 'M-Org-1', role: 'manager' },
  });
  orgManager1Id = orgM1.id;

  const orgM2 = await prisma.user.create({
    data: { email: `${uniq('m-org-2')}@t.local`, name: 'M-Org-2', role: 'manager' },
  });
  orgManager2Id = orgM2.id;

  const deactM = await prisma.user.create({
    data: { email: `${uniq('m-org-deact')}@t.local`, name: 'M-Org-Deact', role: 'manager' },
  });
  deactivatedAssignmentManagerId = deactM.id;

  const histM = await prisma.user.create({
    data: { email: `${uniq('m-hist')}@t.local`, name: 'M-Historical', role: 'manager' },
  });
  historicalCommenterId = histM.id;

  const inactiveM = await prisma.user.create({
    data: {
      email: `${uniq('m-inactive-user')}@t.local`,
      name: 'M-Inactive-User',
      role: 'manager',
      isActive: false,
    },
  });
  inactiveUserManagerId = inactiveM.id;

  const unrelatedM = await prisma.user.create({
    data: { email: `${uniq('m-unrelated')}@t.local`, name: 'M-Unrelated', role: 'manager' },
  });
  unrelatedManagerId = unrelatedM.id;

  // Per-org assignments to orgA: 2 active + 1 deactivated + 1 inactive-User
  await prisma.organizationManager.create({
    data: { organizationId: orgAId, userId: orgManager1Id, isActive: true },
  });
  await prisma.organizationManager.create({
    data: { organizationId: orgAId, userId: orgManager2Id, isActive: true },
  });
  await prisma.organizationManager.create({
    data: {
      organizationId: orgAId,
      userId: deactivatedAssignmentManagerId,
      isActive: false,
    },
  });
  await prisma.organizationManager.create({
    data: { organizationId: orgAId, userId: inactiveUserManagerId, isActive: true },
  });

  // ----- Orders ------------------------------------------------------------
  // Per-order test: order on orgB (no orgB managers), only managerId set
  const o1 = await prisma.order.create({
    data: {
      title: uniq('order-per-order'),
      companyId,
      partnerId,
      organizationId: orgBId,
      managerId: perOrderManagerId,
      executionStatus: 'in_progress',
    },
  });
  orderPerOrderId = o1.id;

  // Per-org test: order on orgA, no managerId — 2 active org managers,
  // 1 deactivated assignment, 1 inactive user-with-active-assignment.
  const o2 = await prisma.order.create({
    data: {
      title: uniq('order-per-org'),
      companyId,
      partnerId,
      organizationId: orgAId,
      executionStatus: 'in_progress',
    },
  });
  orderPerOrgId = o2.id;

  // Historical test: order on orgB (no current assignment of any kind),
  // and a single comment by a manager — that manager should still be a
  // recipient via path (c).
  const o3 = await prisma.order.create({
    data: {
      title: uniq('order-historical'),
      companyId,
      partnerId,
      organizationId: orgBId,
      executionStatus: 'in_progress',
    },
  });
  orderHistoricalId = o3.id;
  await prisma.comment.create({
    data: { orderId: orderHistoricalId, authorId: historicalCommenterId, body: 'hist note' },
  });

  // Dedupe test: order on orgA, managerId == orgManager1Id (he's also in
  // OrganizationManager active list) → expect 1 recipient, not 2.
  const o4 = await prisma.order.create({
    data: {
      title: uniq('order-dedupe'),
      companyId,
      partnerId,
      organizationId: orgAId,
      managerId: orgManager1Id,
      executionStatus: 'in_progress',
    },
  });
  orderDedupeId = o4.id;

  // Exclude test: same as per-org but we'll exclude orgManager1Id (actor).
  const o5 = await prisma.order.create({
    data: {
      title: uniq('order-exclude'),
      companyId,
      partnerId,
      organizationId: orgAId,
      executionStatus: 'in_progress',
    },
  });
  orderExcludeId = o5.id;

  // RESEND-off test: same shape as per-order test
  const o6 = await prisma.order.create({
    data: {
      title: uniq('order-resend-off'),
      companyId,
      partnerId,
      organizationId: orgBId,
      managerId: perOrderManagerId,
      executionStatus: 'in_progress',
    },
  });
  orderRESEndOffId = o6.id;

  // Inactive-user test: order on orgB, managerId == inactiveUserManagerId.
  // Even though they're "assigned", User.isActive=false → must be excluded.
  const o7 = await prisma.order.create({
    data: {
      title: uniq('order-inactive-user'),
      companyId,
      partnerId,
      organizationId: orgBId,
      managerId: inactiveUserManagerId,
      executionStatus: 'in_progress',
    },
  });
  orderInactiveUserId = o7.id;
});

afterAll(async () => {
  const orderIds = [
    orderPerOrderId,
    orderPerOrgId,
    orderHistoricalId,
    orderDedupeId,
    orderExcludeId,
    orderRESEndOffId,
    orderInactiveUserId,
  ].filter(Boolean);
  const userIds = [
    perOrderManagerId,
    orgManager1Id,
    orgManager2Id,
    deactivatedAssignmentManagerId,
    historicalCommenterId,
    inactiveUserManagerId,
    unrelatedManagerId,
  ].filter(Boolean);
  const orgIds = [orgAId, orgBId].filter(Boolean);

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.comment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.organizationManager.deleteMany({
    where: { organizationId: { in: orgIds } },
  });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Wipe notifications between tests so per-test assertions are isolated.
  await prisma.notification.deleteMany({
    where: {
      userId: {
        in: [
          perOrderManagerId,
          orgManager1Id,
          orgManager2Id,
          deactivatedAssignmentManagerId,
          historicalCommenterId,
          inactiveUserManagerId,
          unrelatedManagerId,
        ],
      },
    },
  });
  delete process.env.EMAIL_ENABLED;
});

describe('notifyManagers', () => {
  it('per-order: managerId set, no org managers → 1 recipient', async () => {
    const summary = await notifyManagers(prisma, {
      orderId: orderPerOrderId,
      type: 'comment_from_org',
      payload: { orgName: 'OrgX', commentExcerpt: 'hello' },
    });

    expect(summary.recipientsNotified).toBe(1);
    expect(summary.emailsSent).toBe(0); // EMAIL_ENABLED unset → skipped
    expect(summary.emailsSkipped).toBe(1);

    const rows = await prisma.notification.findMany({
      where: { userId: perOrderManagerId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('comment_from_org');
    expect(rows[0].title).toContain('OrgX');
    const meta = rows[0].meta as Record<string, unknown>;
    expect(meta.orderId).toBe(orderPerOrderId);
    expect(meta.commentExcerpt).toBe('hello');
  });

  it('per-org: 2 active OrganizationManager, 1 deactivated assignment → 2 recipients', async () => {
    const summary = await notifyManagers(prisma, {
      orderId: orderPerOrgId,
      type: 'order_marked_paid_by_1c',
      payload: { amount: 100000, paidAt: new Date('2026-05-26T00:00:00Z') },
    });

    // 2 active org managers; deactivated assignment + inactive-user excluded.
    expect(summary.recipientsNotified).toBe(2);

    const rows = await prisma.notification.findMany({
      where: { type: 'order_marked_paid_by_1c', userId: { in: allManagerIds() } },
    });
    const userIds = rows.map((r) => r.userId).sort();
    expect(userIds).toEqual([orgManager1Id, orgManager2Id].sort());

    // Deactivated assignment & inactive user → not recipients
    expect(userIds).not.toContain(deactivatedAssignmentManagerId);
    expect(userIds).not.toContain(inactiveUserManagerId);

    // paidAt serialized as ISO string in meta
    const meta = rows[0].meta as Record<string, unknown>;
    expect(meta.paidAt).toBe('2026-05-26T00:00:00.000Z');
  });

  it('historical: distinct manager commenter is a recipient even with no current assignment', async () => {
    const summary = await notifyManagers(prisma, {
      orderId: orderHistoricalId,
      type: 'comment_from_org',
      payload: { orgName: 'OrgX', commentExcerpt: 'second comment' },
    });
    expect(summary.recipientsNotified).toBe(1);

    const rows = await prisma.notification.findMany({
      where: { userId: historicalCommenterId, type: 'comment_from_org' },
    });
    expect(rows).toHaveLength(1);
  });

  it('dedupe: user matches both managerId and OrganizationManager → 1 notification', async () => {
    const summary = await notifyManagers(prisma, {
      orderId: orderDedupeId,
      type: 'order_status_changed_by_manager',
      payload: {
        actorName: 'Actor',
        oldStatus: 'pending',
        newStatus: 'in_progress',
      },
    });

    // orderDedupe org is orgA → expected recipients: orgManager1 (per-order
    // + org), orgManager2 (org). Dedup means orgManager1 still gets just
    // one notification row.
    expect(summary.recipientsNotified).toBe(2);

    const rows = await prisma.notification.findMany({
      where: { type: 'order_status_changed_by_manager', userId: { in: allManagerIds() } },
    });
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.userId] = (acc[r.userId] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts[orgManager1Id]).toBe(1);
    expect(counts[orgManager2Id]).toBe(1);
  });

  it('excludeUserId: actor is filtered out of recipients', async () => {
    // orderExclude org=orgA → recipients without exclude = [orgManager1, orgManager2]
    const summary = await notifyManagers(
      prisma,
      {
        orderId: orderExcludeId,
        type: 'order_status_changed_by_manager',
        payload: { actorName: 'Actor', oldStatus: 'pending', newStatus: 'in_progress' },
      },
      { excludeUserId: orgManager1Id }
    );

    expect(summary.recipientsNotified).toBe(1);

    const rows = await prisma.notification.findMany({
      where: { type: 'order_status_changed_by_manager', userId: { in: allManagerIds() } },
    });
    const userIds = rows.map((r) => r.userId);
    expect(userIds).toEqual([orgManager2Id]);
    expect(userIds).not.toContain(orgManager1Id);
  });

  it('RESEND off (EMAIL_ENABLED unset): Notification rows still created, emails skipped', async () => {
    delete process.env.EMAIL_ENABLED;
    const summary = await notifyManagers(prisma, {
      orderId: orderRESEndOffId,
      type: 'comment_from_org',
      payload: { orgName: 'OrgX', commentExcerpt: 'skip-email' },
    });

    expect(summary.recipientsNotified).toBe(1);
    expect(summary.emailsSent).toBe(0);
    expect(summary.emailsSkipped).toBe(1);

    const rows = await prisma.notification.findMany({
      where: { userId: perOrderManagerId, type: 'comment_from_org' },
    });
    expect(rows).toHaveLength(1);
  });

  it('manager user deactivated → not in recipient list even with active assignment', async () => {
    const recipients = await resolveManagerRecipients(prisma, orderInactiveUserId);
    expect(recipients.map((r) => r.id)).not.toContain(inactiveUserManagerId);
    // The inactive user was the only recipient candidate → empty.
    expect(recipients).toEqual([]);

    const summary = await notifyManagers(prisma, {
      orderId: orderInactiveUserId,
      type: 'comment_from_org',
      payload: { orgName: 'OrgX', commentExcerpt: 'nobody home' },
    });
    expect(summary.recipientsNotified).toBe(0);
  });

  it('non-existent order → zero summary', async () => {
    const summary = await notifyManagers(prisma, {
      orderId: 'does-not-exist',
      type: 'comment_from_org',
      payload: { orgName: 'OrgX', commentExcerpt: 'noop' },
    });
    expect(summary).toEqual({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
  });
});
