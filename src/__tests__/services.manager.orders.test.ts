import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrders, getOrder } from '@/lib/services/manager/orders';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;

let companyId: string;
let partnerId: string;
let foreignPartnerId: string;
let orgAId: string;
let orgBId: string;
let userAId: string;
let userBId: string;
let userCId: string;
let orgUserAId: string;

let orderOrgAId: string;          // belongs to orgA
let orderOrgBId: string;          // belongs to orgB
let orderManagerCId: string;      // belongs to orgB, manager=userC
let orderForeignId: string;       // no link to any test user

function managerSession(userId: string, managedOrgIds: string[]): SessionPayload {
  return { sub: userId, role: 'manager', managedOrgIds };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const company = await prisma.company.create({ data: { name: `MgrOrdC-${stamp}` } });
  companyId = company.id;
  const partner = await prisma.partner.create({
    data: { name: `MgrOrdP-${stamp}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const foreignPartner = await prisma.partner.create({
    data: { name: `MgrOrdFP-${stamp}`, commissionRate: 0.1 }
  });
  foreignPartnerId = foreignPartner.id;

  const orgA = await prisma.organization.create({
    data: { name: `MgrOrdOrgA-${stamp}`, partnerId, companyId }
  });
  orgAId = orgA.id;
  const orgB = await prisma.organization.create({
    data: { name: `MgrOrdOrgB-${stamp}`, partnerId, companyId }
  });
  orgBId = orgB.id;

  const userA = await prisma.user.create({
    data: {
      email: `mgr-ord-a-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager A',
      role: 'manager'
    }
  });
  userAId = userA.id;
  const userB = await prisma.user.create({
    data: {
      email: `mgr-ord-b-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager B',
      role: 'manager'
    }
  });
  userBId = userB.id;
  const userC = await prisma.user.create({
    data: {
      email: `mgr-ord-c-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager C',
      role: 'manager'
    }
  });
  userCId = userC.id;

  const orgUserA = await prisma.user.create({
    data: {
      email: `mgr-ord-orguser-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'OrgUser A',
      role: 'organization',
      organizationId: orgAId
    }
  });
  orgUserAId = orgUserA.id;

  // userA assigned to orgA; userB assigned to orgB; userC has no assignment.
  await prisma.organizationManager.create({
    data: { organizationId: orgAId, userId: userAId, isActive: true }
  });
  await prisma.organizationManager.create({
    data: { organizationId: orgBId, userId: userBId, isActive: true }
  });

  // Order in orgA, no specific manager.
  const oA = await prisma.order.create({
    data: {
      title: `MgrOrdA1-${stamp}`,
      orderNumber: `MO-A1-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgAId,
      executionStatus: 'in_progress',
      financialStatus: 'partially_paid',
      totalAmount: 100000,
      paidAmount: 25000
    }
  });
  orderOrgAId = oA.id;

  // Order in orgB, no specific manager.
  const oB = await prisma.order.create({
    data: {
      title: `MgrOrdB1-${stamp}`,
      orderNumber: `MO-B1-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgBId,
      executionStatus: 'pending',
      financialStatus: 'billed',
      totalAmount: 50000
    }
  });
  orderOrgBId = oB.id;

  // Order in orgB but with managerId=userC (per-order link for userC).
  const oMC = await prisma.order.create({
    data: {
      title: `MgrOrdMC-${stamp}`,
      orderNumber: `MO-MC-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgBId,
      managerId: userCId,
      executionStatus: 'in_progress'
    }
  });
  orderManagerCId = oMC.id;

  // Foreign order with no link to A/B/C at all.
  const oF = await prisma.order.create({
    data: {
      title: `MgrOrdF1-${stamp}`,
      orderNumber: `MO-F1-${stamp}`,
      companyId,
      partnerId: foreignPartnerId,
      organizationId: orgBId,
      executionStatus: 'completed'
    }
  });
  orderForeignId = oF.id;

  // Sample document, payment, and a comment on the orgA order so the include
  // shapes are exercised in getOrder.
  await prisma.document.create({
    data: {
      name: 'contract.pdf',
      path: 'fake://contract',
      mimeType: 'application/pdf',
      type: 'contract',
      orderId: orderOrgAId,
      counterpartyType: 'organization',
      counterpartyId: orgAId
    }
  });
  await prisma.document.create({
    data: {
      name: 'infected.pdf',
      path: 'fake://infected',
      mimeType: 'application/pdf',
      type: 'other',
      orderId: orderOrgAId,
      scanStatus: 'infected',
      counterpartyType: 'organization',
      counterpartyId: orgAId
    }
  });
  await prisma.payment.create({
    data: { organizationId: orgAId, orderId: orderOrgAId, amount: 25000, paidAt: new Date(), method: 'bank' }
  });
});

afterAll(async () => {
  // FK-walk cleanup (mirrors services.manager.dashboard.test.ts).
  const userIds = [userAId, userBId, userCId, orgUserAId];
  const orgIds = [orgAId, orgBId];

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.comment.deleteMany({
    where: { OR: [{ authorId: { in: userIds } }, { order: { organizationId: { in: orgIds } } }] }
  });
  await prisma.payment.deleteMany({ where: { order: { organizationId: { in: orgIds } } } });
  await prisma.document.deleteMany({ where: { order: { organizationId: { in: orgIds } } } });
  await prisma.order.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationManager.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerId, foreignPartnerId] } } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('services/manager/orders — listOrders RBAC scope', () => {
  it('per-org scope: userA sees orgA orders but not orgB-only orders', async () => {
    const session = managerSession(userAId, [orgAId]);
    const { rows } = await listOrders(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderOrgAId);
    expect(ids).not.toContain(orderOrgBId);
    expect(ids).not.toContain(orderManagerCId);
    expect(ids).not.toContain(orderForeignId);
  });

  it('per-org scope: userB sees orgB orders (both unassigned and manager=userC)', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listOrders(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderOrgBId);
    expect(ids).toContain(orderManagerCId);
    expect(ids).toContain(orderForeignId); // also in orgB
    expect(ids).not.toContain(orderOrgAId);
  });

  it('per-order scope: userC has no org assignment but still sees own managed order', async () => {
    const session = managerSession(userCId, []);
    const { rows } = await listOrders(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([orderManagerCId]);
  });

  it('returns empty for assignmentless manager with no per-order links', async () => {
    const ghost = await prisma.user.create({
      data: {
        email: `ghost-${Date.now()}@t.local`,
        passwordHash: 'x',
        role: 'manager',
        name: 'Ghost'
      }
    });
    try {
      const session = managerSession(ghost.id, []);
      const { rows } = await listOrders(prisma, { session, take: 100 });
      expect(rows).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: ghost.id } });
    }
  });
});

describe('services/manager/orders — listOrders filters', () => {
  it('filters by executionStatus within scope', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listOrders(prisma, {
      session,
      executionStatus: 'in_progress',
      take: 100
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderManagerCId);
    expect(ids).not.toContain(orderOrgBId); // pending, not in_progress
    expect(ids).not.toContain(orderForeignId); // completed
  });

  it('filters by financialStatus within scope', async () => {
    const session = managerSession(userAId, [orgAId]);
    const { rows } = await listOrders(prisma, {
      session,
      financialStatus: 'partially_paid',
      take: 100
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderOrgAId);
  });

  it('filters by organizationId — narrows orgB to orgB (no-op) but excludes others', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listOrders(prisma, {
      session,
      organizationId: orgBId,
      take: 100
    });
    for (const r of rows) {
      expect(r.organizationId).toBe(orgBId);
    }
  });

  it('search matches orderNumber case-insensitively within scope', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listOrders(prisma, { session, search: 'mo-mc' });
    expect(rows.some((r) => r.id === orderManagerCId)).toBe(true);
    expect(rows.every((r) => r.id !== orderOrgAId)).toBe(true);
  });

  it('returns nextCursor when more than `take` rows match, paginates correctly', async () => {
    const session = managerSession(userBId, [orgBId]);
    const first = await listOrders(prisma, { session, take: 1 });
    expect(first.rows.length).toBe(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listOrders(prisma, {
      session,
      take: 1,
      cursor: first.nextCursor!
    });
    expect(second.rows.length).toBe(1);
    expect(second.rows[0]!.id).not.toBe(first.rows[0]!.id);
  });

  it('includes organization and manager relations on each row', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listOrders(prisma, { session, take: 100 });
    const mcRow = rows.find((r) => r.id === orderManagerCId);
    expect(mcRow).toBeDefined();
    expect(mcRow!.organization?.id).toBe(orgBId);
    expect(mcRow!.organization?.name).toBeTruthy();
    expect(mcRow!.manager?.id).toBe(userCId);
    expect(mcRow!.manager?.email).toContain('@t.local');
  });

  it('rejects take > 100 via zod validation', async () => {
    const session = managerSession(userAId, [orgAId]);
    await expect(
      listOrders(prisma, { session, take: 9999 })
    ).rejects.toThrow();
  });
});

describe('services/manager/orders — getOrder', () => {
  it('returns the order detail (with documents excluding infected) for an in-scope order', async () => {
    const session = managerSession(userAId, [orgAId]);
    const detail = await getOrder(prisma, session, orderOrgAId);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(orderOrgAId);
    expect(detail!.documents.map((d) => d.name)).toEqual(['contract.pdf']);
    expect(detail!.payments.length).toBe(1);
    expect(detail!.organization?.id).toBe(orgAId);
    expect(detail!._count.comments).toBe(0);
    expect(detail!.commentsCountByMe).toBe(0);
  });

  it('returns null for a foreign order with no RBAC link', async () => {
    const session = managerSession(userAId, [orgAId]);
    const detail = await getOrder(prisma, session, orderOrgBId);
    expect(detail).toBeNull();
  });

  it('returns null for non-existent order id', async () => {
    const session = managerSession(userAId, [orgAId]);
    const detail = await getOrder(prisma, session, 'nonexistent-cuid');
    expect(detail).toBeNull();
  });

  it('per-order path: userC sees own managed order via getOrder', async () => {
    const session = managerSession(userCId, []);
    const detail = await getOrder(prisma, session, orderManagerCId);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(orderManagerCId);
  });

  it('comments-history path: userA keeps seeing an orgB order via past comment after assignment is removed', async () => {
    // Pre-condition: userA was *never* assigned to orgB. To validate the
    // historical-comments branch, we make userA leave a comment on the orgB
    // order, then admin removes userA's orgA assignment, then we call
    // getOrder with a session that has *no* managedOrgIds.
    await prisma.comment.create({
      data: { orderId: orderOrgBId, body: 'historical reply', authorId: userAId }
    });
    // Admin removes userA-assignment from orgA (we're modelling complete
    // removal of any active assignment).
    await prisma.organizationManager.deleteMany({ where: { userId: userAId } });

    try {
      const session = managerSession(userAId, []); // session reflects post-removal state
      const detail = await getOrder(prisma, session, orderOrgBId);
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe(orderOrgBId);
      expect(detail!.commentsCountByMe).toBe(1);
    } finally {
      // Restore the assignment so unrelated tests in this file or in suite
      // ordering aren't disturbed (afterAll wipes everything anyway, but this
      // keeps this test self-contained against shared state).
      await prisma.organizationManager.create({
        data: { organizationId: orgAId, userId: userAId, isActive: true }
      });
    }
  });
});
