import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type Role } from '@prisma/client';
import { resolveManagerRecipients } from '@/lib/notifications';
import { canSeeOrder } from '@/lib/auth/managerPolicy';
import type { SessionPayload } from '@/lib/auth/jwt';

// Visibility/notification invariant for the manager cabinet (spec §8.1):
//   recipientsOf(orderId).map(r => r.id).sort()
//     === [for each manager m: canSeeOrder(buildSession(m), order)]
//         .filter(true).map(m => m.id).sort()
//
// In other words: the users notifyManagers fans out to for an order must
// be exactly the users managerOrderScopeFilter-style RBAC would allow to
// read that order. If the two ever diverge, either a manager silently
// loses notifications OR an unrelated user gets emailed about an order
// they can't open. We assert across a 5-manager × 3-order grid with
// mixed assignment patterns.

let prisma: PrismaClient;

const STAMP = Date.now();

type ManagerFixture = {
  id: string;
  // managedOrgIds derived from OrganizationManager rows for this user.
  // We mirror the session loader (Task 4) here at test time so we don't
  // need to call the real login path.
  session: SessionPayload;
};

let companyId: string;
let partnerId: string;
let orgAId: string;
let orgBId: string;
let orgCId: string;

let managers: ManagerFixture[] = [];
let managerIds: string[] = [];
let orderIds: string[] = [];

function buildSession(
  userId: string,
  managedOrgIds: string[]
): SessionPayload {
  return {
    sub: userId,
    role: 'manager' as Role,
    managedOrgIds
  };
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const company = await prisma.company.create({
    data: { name: `inv-co-${STAMP}` }
  });
  companyId = company.id;
  const partner = await prisma.partner.create({
    data: { name: `inv-p-${STAMP}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;

  const orgA = await prisma.organization.create({
    data: { name: `inv-orgA-${STAMP}`, partnerId, companyId }
  });
  orgAId = orgA.id;
  const orgB = await prisma.organization.create({
    data: { name: `inv-orgB-${STAMP}`, partnerId, companyId }
  });
  orgBId = orgB.id;
  const orgC = await prisma.organization.create({
    data: { name: `inv-orgC-${STAMP}`, partnerId, companyId }
  });
  orgCId = orgC.id;

  // 5 manager users
  const userRows = await Promise.all(
    [0, 1, 2, 3, 4].map((i) =>
      prisma.user.create({
        data: {
          email: `inv-m${i}-${STAMP}@t.local`,
          name: `Inv-M${i}`,
          role: 'manager'
        }
      })
    )
  );
  managerIds = userRows.map((u) => u.id);

  // Assignment matrix (active OrganizationManager rows):
  //   M0 → orgA
  //   M1 → orgA, orgB
  //   M2 → orgB
  //   M3 → (none — only per-order assignment / historical comments)
  //   M4 → orgC, but we'll deactivate one to test isActive=false
  await prisma.organizationManager.createMany({
    data: [
      { organizationId: orgAId, userId: managerIds[0], isActive: true },
      { organizationId: orgAId, userId: managerIds[1], isActive: true },
      { organizationId: orgBId, userId: managerIds[1], isActive: true },
      { organizationId: orgBId, userId: managerIds[2], isActive: true },
      { organizationId: orgCId, userId: managerIds[4], isActive: true },
      // Deactivated assignment — must NOT contribute to managedOrgIds
      { organizationId: orgCId, userId: managerIds[3], isActive: false }
    ]
  });

  // Build session payloads mirroring the login loader behavior (Task 4):
  // managedOrgIds = active OrganizationManager rows for this user.
  managers = await Promise.all(
    managerIds.map(async (id) => {
      const assigns = await prisma.organizationManager.findMany({
        where: { userId: id, isActive: true },
        select: { organizationId: true }
      });
      return {
        id,
        session: buildSession(
          id,
          assigns.map((a) => a.organizationId)
        )
      };
    })
  );

  // 3 orders with mixed patterns:
  //   O1: orgA, managerId = M3 (per-order assignment for M3, per-org for M0/M1)
  //   O2: orgB, managerId = null (per-org only for M1/M2; M0 will comment)
  //   O3: orgC, managerId = M0 (per-order for M0; per-org for M4;
  //                              M3 deactivated assignment must NOT match)
  const o1 = await prisma.order.create({
    data: {
      title: `inv-O1-${STAMP}`,
      companyId,
      partnerId,
      organizationId: orgAId,
      managerId: managerIds[3],
      executionStatus: 'in_progress'
    }
  });
  const o2 = await prisma.order.create({
    data: {
      title: `inv-O2-${STAMP}`,
      companyId,
      partnerId,
      organizationId: orgBId,
      executionStatus: 'in_progress'
    }
  });
  const o3 = await prisma.order.create({
    data: {
      title: `inv-O3-${STAMP}`,
      companyId,
      partnerId,
      organizationId: orgCId,
      managerId: managerIds[0],
      executionStatus: 'in_progress'
    }
  });
  orderIds = [o1.id, o2.id, o3.id];

  // Historical comments: M0 has commented on O2 (he wasn't otherwise in scope
  // for O2). This is path (c) — historical commenter.
  await prisma.comment.create({
    data: { orderId: o2.id, authorId: managerIds[0], body: 'past note' }
  });
});

afterAll(async () => {
  await prisma.comment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.organizationManager.deleteMany({
    where: { organizationId: { in: [orgAId, orgBId, orgCId] } }
  });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: managerIds } } });
  await prisma.organization.deleteMany({
    where: { id: { in: [orgAId, orgBId, orgCId] } }
  });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.$disconnect();
});

describe('notifyManagers / managerOrderScopeFilter visibility invariant', () => {
  it('recipient set === RBAC visibility set for every (order, manager) pair', async () => {
    for (const orderId of orderIds) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, managerId: true, organizationId: true }
      });
      expect(order).not.toBeNull();

      // Side A: who notifyManagers would email
      const recipients = await resolveManagerRecipients(prisma, orderId);
      const recipientIds = recipients.map((r) => r.id).sort();

      // Side B: who canSeeOrder(session(m), order) returns true for
      const visibleIds: string[] = [];
      for (const m of managers) {
        const commentsCountByMe = await prisma.comment.count({
          where: { orderId, authorId: m.id }
        });
        const visible = canSeeOrder(m.session, {
          managerId: order!.managerId,
          organizationId: order!.organizationId,
          commentsCountByMe
        });
        if (visible) visibleIds.push(m.id);
      }
      visibleIds.sort();

      expect(recipientIds, `order ${orderId}: visibility/notification mismatch`).toEqual(
        visibleIds
      );
    }
  });

  it('O1 (orgA, managerId=M3) recipients = {M0, M1, M3}', async () => {
    const recipients = await resolveManagerRecipients(prisma, orderIds[0]);
    expect(recipients.map((r) => r.id).sort()).toEqual(
      [managerIds[0], managerIds[1], managerIds[3]].sort()
    );
  });

  it('O2 (orgB, no managerId, M0 historical comment) recipients = {M0, M1, M2}', async () => {
    const recipients = await resolveManagerRecipients(prisma, orderIds[1]);
    expect(recipients.map((r) => r.id).sort()).toEqual(
      [managerIds[0], managerIds[1], managerIds[2]].sort()
    );
  });

  it('O3 (orgC, managerId=M0, M3 deactivated assignment) recipients = {M0, M4}', async () => {
    const recipients = await resolveManagerRecipients(prisma, orderIds[2]);
    expect(recipients.map((r) => r.id).sort()).toEqual(
      [managerIds[0], managerIds[4]].sort()
    );
    // Critical: M3 has a deactivated OrganizationManager row for orgC and
    // must NOT appear as a recipient.
    expect(recipients.map((r) => r.id)).not.toContain(managerIds[3]);
  });
});
