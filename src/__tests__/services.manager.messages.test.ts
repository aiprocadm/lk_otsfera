import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listIncomingComments } from '@/lib/services/manager/messages';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;

let companyId: string;
let partnerId: string;
let foreignPartnerId: string;
let orgAId: string;
let orgBId: string;

let mgrAId: string; // assigned to orgA
let mgrBId: string; // assigned to orgB
let orgUserAId: string; // organization user in orgA
let orgUserBId: string; // organization user in orgB

let orderOrgAId: string;
let orderOrgBId: string;
let orderForeignId: string; // belongs to orgB but mgrA shouldn't see it

let commentOrgAOldId: string; // 60d-old org comment on orderOrgA
let commentOrgARecentId: string; // recent org comment on orderOrgA
let commentMgrAReplyId: string; // recent manager reply by mgrA on orderOrgA
let commentOrgBRecentId: string; // recent org comment on orderOrgB
let commentExtraOrgAId: string; // extra org comment for pagination

function managerSession(userId: string, managedOrgIds: string[]): SessionPayload {
  return { sub: userId, role: 'manager', managedOrgIds };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const company = await prisma.company.create({ data: { name: `MgrMsgC-${stamp}` } });
  companyId = company.id;
  const partner = await prisma.partner.create({
    data: { name: `MgrMsgP-${stamp}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const foreignPartner = await prisma.partner.create({
    data: { name: `MgrMsgFP-${stamp}`, commissionRate: 0.1 }
  });
  foreignPartnerId = foreignPartner.id;

  const orgA = await prisma.organization.create({
    data: { name: `MgrMsgOrgA-${stamp}`, partnerId, companyId }
  });
  orgAId = orgA.id;
  const orgB = await prisma.organization.create({
    data: { name: `MgrMsgOrgB-${stamp}`, partnerId, companyId }
  });
  orgBId = orgB.id;

  const mgrA = await prisma.user.create({
    data: {
      email: `mgr-msg-a-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager A',
      role: 'manager'
    }
  });
  mgrAId = mgrA.id;
  const mgrB = await prisma.user.create({
    data: {
      email: `mgr-msg-b-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager B',
      role: 'manager'
    }
  });
  mgrBId = mgrB.id;

  const orgUserA = await prisma.user.create({
    data: {
      email: `mgr-msg-org-a-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'OrgUser A',
      role: 'organization',
      organizationId: orgAId
    }
  });
  orgUserAId = orgUserA.id;
  const orgUserB = await prisma.user.create({
    data: {
      email: `mgr-msg-org-b-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'OrgUser B',
      role: 'organization',
      organizationId: orgBId
    }
  });
  orgUserBId = orgUserB.id;

  await prisma.organizationManager.create({
    data: { organizationId: orgAId, userId: mgrAId, isActive: true }
  });
  await prisma.organizationManager.create({
    data: { organizationId: orgBId, userId: mgrBId, isActive: true }
  });

  const oA = await prisma.order.create({
    data: {
      title: `MgrMsgOrderA-${stamp}`,
      orderNumber: `MM-A-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgAId
    }
  });
  orderOrgAId = oA.id;
  const oB = await prisma.order.create({
    data: {
      title: `MgrMsgOrderB-${stamp}`,
      orderNumber: `MM-B-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgBId
    }
  });
  orderOrgBId = oB.id;
  const oF = await prisma.order.create({
    data: {
      title: `MgrMsgOrderF-${stamp}`,
      orderNumber: `MM-F-${stamp}`,
      companyId,
      partnerId: foreignPartnerId,
      organizationId: orgBId
    }
  });
  orderForeignId = oF.id;

  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Old org comment on orderA (outside default 30-day window).
  const cOld = await prisma.comment.create({
    data: {
      orderId: orderOrgAId,
      body: 'old org question',
      authorId: orgUserAId,
      createdAt: sixtyDaysAgo
    }
  });
  commentOrgAOldId = cOld.id;
  // Recent org comment on orderA.
  const cRecent = await prisma.comment.create({
    data: {
      orderId: orderOrgAId,
      body: 'recent org question',
      authorId: orgUserAId
    }
  });
  commentOrgARecentId = cRecent.id;
  // Recent manager reply by mgrA on orderA.
  const cMgr = await prisma.comment.create({
    data: {
      orderId: orderOrgAId,
      body: 'recent manager reply',
      authorId: mgrAId
    }
  });
  commentMgrAReplyId = cMgr.id;
  // Recent org comment on orderB (out of mgrA's scope, in mgrB's scope).
  const cB = await prisma.comment.create({
    data: {
      orderId: orderOrgBId,
      body: 'org b question',
      authorId: orgUserBId
    }
  });
  commentOrgBRecentId = cB.id;
  // Foreign-order org comment (in orgB but we'll filter via mgrA — out of scope).
  await prisma.comment.create({
    data: {
      orderId: orderForeignId,
      body: 'foreign question',
      authorId: orgUserBId
    }
  });
  // Extra recent org comment on orderA for pagination cursor test.
  const cExtra = await prisma.comment.create({
    data: {
      orderId: orderOrgAId,
      body: 'another org question',
      authorId: orgUserAId
    }
  });
  commentExtraOrgAId = cExtra.id;
});

afterAll(async () => {
  const userIds = [mgrAId, mgrBId, orgUserAId, orgUserBId];
  const orgIds = [orgAId, orgBId];

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.comment.deleteMany({
    where: {
      OR: [{ authorId: { in: userIds } }, { order: { organizationId: { in: orgIds } } }]
    }
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

describe('services/manager/messages — listIncomingComments author filter', () => {
  it('withOutgoing=false returns only organization-authored comments', async () => {
    const session = managerSession(mgrAId, [orgAId]);
    const { rows } = await listIncomingComments(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(commentOrgARecentId);
    expect(ids).toContain(commentExtraOrgAId);
    expect(ids).not.toContain(commentMgrAReplyId);
    for (const r of rows) {
      expect(r.author.role).toBe('organization');
    }
  });

  it('withOutgoing=true mixes in manager-authored comments', async () => {
    const session = managerSession(mgrAId, [orgAId]);
    const { rows } = await listIncomingComments(prisma, {
      session,
      withOutgoing: true,
      take: 100
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(commentOrgARecentId);
    expect(ids).toContain(commentMgrAReplyId);
    const roles = new Set(rows.map((r) => r.author.role));
    expect(roles.has('organization')).toBe(true);
    expect(roles.has('manager')).toBe(true);
  });
});

describe('services/manager/messages — listIncomingComments since filter', () => {
  it('default 30-day window excludes the 60-day-old comment', async () => {
    const session = managerSession(mgrAId, [orgAId]);
    const { rows } = await listIncomingComments(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(commentOrgAOldId);
  });

  it('explicit since=epoch includes the older comment', async () => {
    const session = managerSession(mgrAId, [orgAId]);
    const { rows } = await listIncomingComments(prisma, {
      session,
      since: new Date(0),
      take: 100
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(commentOrgAOldId);
  });
});

describe('services/manager/messages — listIncomingComments RBAC scope', () => {
  it('mgrA does not see comments on orders outside their scope', async () => {
    const session = managerSession(mgrAId, [orgAId]);
    const { rows } = await listIncomingComments(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(commentOrgBRecentId);
    for (const r of rows) {
      expect(r.order.id).toBe(orderOrgAId);
    }
  });

  it('mgrB sees orgB comments and not orgA', async () => {
    const session = managerSession(mgrBId, [orgBId]);
    const { rows } = await listIncomingComments(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(commentOrgBRecentId);
    expect(ids).not.toContain(commentOrgARecentId);
  });

  it('manager with no scope sees nothing', async () => {
    const ghost = await prisma.user.create({
      data: {
        email: `ghost-msg-${Date.now()}@t.local`,
        passwordHash: 'x',
        role: 'manager',
        name: 'Ghost'
      }
    });
    try {
      const session = managerSession(ghost.id, []);
      const { rows } = await listIncomingComments(prisma, { session, take: 100 });
      expect(rows).toEqual([]);
    } finally {
      await prisma.user.delete({ where: { id: ghost.id } });
    }
  });
});

describe('services/manager/messages — listIncomingComments pagination', () => {
  it('returns nextCursor when more than take rows match, paginates correctly', async () => {
    const session = managerSession(mgrAId, [orgAId]);
    const first = await listIncomingComments(prisma, { session, take: 1 });
    expect(first.rows.length).toBe(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listIncomingComments(prisma, {
      session,
      take: 1,
      cursor: first.nextCursor!
    });
    expect(second.rows.length).toBe(1);
    expect(second.rows[0]!.id).not.toBe(first.rows[0]!.id);
  });

  it('includes order and author relations on each row', async () => {
    const session = managerSession(mgrAId, [orgAId]);
    const { rows } = await listIncomingComments(prisma, { session, take: 100 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.order.id).toBeTruthy();
      expect(r.order.title).toBeTruthy();
      expect(r.author.id).toBeTruthy();
      expect(r.author.role).toBeTruthy();
    }
  });

  it('rejects take > 100 via zod validation', async () => {
    const session = managerSession(mgrAId, [orgAId]);
    await expect(
      listIncomingComments(prisma, { session, take: 9999 })
    ).rejects.toThrow();
  });
});
