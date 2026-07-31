import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrganizations, getOrganization } from '@/lib/services/manager/organizations';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;

let companyId: string;
let partnerId: string;
let orgAId: string;
let orgBId: string;
let orgCId: string;
let userAId: string;
let userBId: string;
let userGhostId: string;
let studentAId: string;

let orderOrgAId: string; // belongs to orgA
let orderOrgBId: string; // belongs to orgB

function managerSession(userId: string, managedOrgIds: string[]): SessionPayload {
  return { sub: userId, role: 'manager', managedOrgIds };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const company = await prisma.company.create({ data: { name: `MgrOrgC-${stamp}` } });
  companyId = company.id;
  const partner = await prisma.partner.create({
    data: { name: `MgrOrgP-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;

  const orgA = await prisma.organization.create({
    data: { name: `MgrOrg-AAA-${stamp}`, partnerId, companyId },
  });
  orgAId = orgA.id;
  const orgB = await prisma.organization.create({
    data: { name: `MgrOrg-BBB-${stamp}`, partnerId, companyId },
  });
  orgBId = orgB.id;
  // orgC is *not* assigned to any of the test users — it's used to assert
  // out-of-scope visibility.
  const orgC = await prisma.organization.create({
    data: { name: `MgrOrg-CCC-${stamp}`, partnerId, companyId },
  });
  orgCId = orgC.id;

  const userA = await prisma.user.create({
    data: {
      email: `mgr-org-a-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager A',
      role: 'manager',
    },
  });
  userAId = userA.id;
  const userB = await prisma.user.create({
    data: {
      email: `mgr-org-b-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager B',
      role: 'manager',
    },
  });
  userBId = userB.id;
  const userGhost = await prisma.user.create({
    data: {
      email: `mgr-org-ghost-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Ghost Manager',
      role: 'manager',
    },
  });
  userGhostId = userGhost.id;

  // userA → orgA + orgB (multi-assignment manager), userB → orgB only.
  await prisma.organizationManager.create({
    data: { organizationId: orgAId, userId: userAId, isActive: true },
  });
  await prisma.organizationManager.create({
    data: { organizationId: orgBId, userId: userAId, isActive: true },
  });
  await prisma.organizationManager.create({
    data: { organizationId: orgBId, userId: userBId, isActive: true },
  });

  // Counts seed: one student in orgA, one order each in orgA / orgB so the
  // `_count` aggregate in listOrganizations and getOrganization is exercised.
  const studentA = await prisma.student.create({
    data: {
      email: `mgr-org-stud-${stamp}@t.local`,
      name: 'Stud A',
      organizationId: orgAId,
    },
  });
  studentAId = studentA.id;

  const oA = await prisma.order.create({
    data: {
      title: `MgrOrgOrdA-${stamp}`,
      orderNumber: `MOO-A-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgAId,
      executionStatus: 'in_progress',
      totalAmount: 1000,
    },
  });
  orderOrgAId = oA.id;

  const oB = await prisma.order.create({
    data: {
      title: `MgrOrgOrdB-${stamp}`,
      orderNumber: `MOO-B-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgBId,
      executionStatus: 'pending',
      totalAmount: 2000,
    },
  });
  orderOrgBId = oB.id;
});

afterAll(async () => {
  const userIds = [userAId, userBId, userGhostId];
  const orgIds = [orgAId, orgBId, orgCId];

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.comment.deleteMany({
    where: { OR: [{ authorId: { in: userIds } }, { order: { organizationId: { in: orgIds } } }] },
  });
  await prisma.payment.deleteMany({ where: { order: { organizationId: { in: orgIds } } } });
  await prisma.document.deleteMany({ where: { order: { organizationId: { in: orgIds } } } });
  await prisma.order.deleteMany({ where: { id: { in: [orderOrgAId, orderOrgBId] } } });
  await prisma.student.deleteMany({ where: { id: studentAId } });
  await prisma.organizationManager.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('services/manager/organizations — listOrganizations RBAC scope', () => {
  it('returns only assigned orgs for a multi-assignment manager (orgA + orgB)', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const rows = await listOrganizations(prisma, session);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orgAId);
    expect(ids).toContain(orgBId);
    expect(ids).not.toContain(orgCId);
  });

  it('returns only the single assigned org for a single-assignment manager (orgB)', async () => {
    const session = managerSession(userBId, [orgBId]);
    const rows = await listOrganizations(prisma, session);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([orgBId]);
  });

  it('returns [] for an assignmentless manager (empty managedOrgIds)', async () => {
    const session = managerSession(userGhostId, []);
    const rows = await listOrganizations(prisma, session);
    expect(rows).toEqual([]);
  });

  it('orders alphabetically by name', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const rows = await listOrganizations(prisma, session);
    const names = rows.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('includes _count aggregates (orders, students) in the row payload', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const rows = await listOrganizations(prisma, session);
    const a = rows.find((r) => r.id === orgAId)!;
    const b = rows.find((r) => r.id === orgBId)!;
    expect(a._count.orders).toBe(1);
    expect(a._count.students).toBe(1);
    expect(b._count.orders).toBe(1);
    expect(b._count.students).toBe(0);
  });
});

describe('services/manager/organizations — getOrganization RBAC + payload', () => {
  it('returns the org with counts and partner ref for an in-scope id', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const org = await getOrganization(prisma, session, orgAId);
    expect(org).not.toBeNull();
    expect(org!.id).toBe(orgAId);
    expect(org!._count.orders).toBe(1);
    expect(org!._count.students).toBe(1);
    expect(org!._count.users).toBeGreaterThanOrEqual(0);
    expect(org!.partner?.id).toBe(partnerId);
  });

  it('returns null for an out-of-scope org id', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const org = await getOrganization(prisma, session, orgCId);
    expect(org).toBeNull();
  });

  it('returns null for a non-existent org id even if it appears in managedOrgIds (defensive)', async () => {
    // Edge case: the session claims access to an id that doesn't exist in DB.
    // managedOrgIds passes canSeeOrganization, but the by-id findUnique returns
    // null — we want null, not a thrown error.
    const session = managerSession(userAId, ['nonexistent-cuid']);
    const org = await getOrganization(prisma, session, 'nonexistent-cuid');
    expect(org).toBeNull();
  });

  it('returns null for an assignmentless manager calling getOrganization on any id', async () => {
    const session = managerSession(userGhostId, []);
    const org = await getOrganization(prisma, session, orgAId);
    expect(org).toBeNull();
  });
});
