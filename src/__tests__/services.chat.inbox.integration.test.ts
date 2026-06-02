import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listMessages } from '@/lib/services/chat/messages';
import { listThreads, markRead, unreadCount } from '@/lib/services/chat/threads';

// new PrismaClient() auto-marks this as integration-mode (see vitest.config.ts)
const prisma = new PrismaClient();

const PREFIX = 'chat-inbox-it';
const PARTNER_SLUG = `${PREFIX}-partner`;
const ORG_EXT_ID = `${PREFIX}-org`;
const ORDER_TITLE = `${PREFIX}-order`;

let partnerId: string;
let organizationId: string;
let companyId: string;
let orderId: string;
let managerId: string;
let orgUserId: string;
let orgThreadId: string;
let partnerThreadId: string;

let managerSession: SessionPayload;
let orgSession: SessionPayload;
let partnerSession: SessionPayload;

async function seedData() {
  const partner = await prisma.partner.create({
    data: { name: `${PREFIX}-Partner`, slug: PARTNER_SLUG, commissionRate: 0.1 }
  });
  partnerId = partner.id;

  const company = await prisma.company.create({
    data: { name: `${PREFIX}-Company` }
  });
  companyId = company.id;

  const org = await prisma.organization.create({
    data: {
      name: `${PREFIX}-Org`,
      externalId: ORG_EXT_ID,
      partnerId,
      companyId
    }
  });
  organizationId = org.id;

  const manager = await prisma.user.create({
    data: {
      email: `${PREFIX}-manager@test.local`,
      name: `${PREFIX}-Manager`,
      role: 'manager',
      isActive: true
    }
  });
  managerId = manager.id;
  managerSession = { sub: managerId, role: 'manager' };

  const orgUser = await prisma.user.create({
    data: {
      email: `${PREFIX}-orguser@test.local`,
      name: `${PREFIX}-OrgUser`,
      role: 'organization',
      isActive: true
    }
  });
  orgUserId = orgUser.id;

  await prisma.organizationUser.create({
    data: { organizationId, userId: orgUserId, roleInOrg: 'member', isActive: true }
  });

  orgSession = {
    sub: orgUserId,
    role: 'organization',
    organizationMemberships: [{ organizationId, roleInOrg: 'member', isActive: true }]
  };

  partnerSession = {
    sub: 'partner-user-inbox-it',
    role: 'partner',
    partnerId
  };

  const order = await prisma.order.create({
    data: {
      title: ORDER_TITLE,
      partnerId,
      organizationId,
      companyId
    }
  });
  orderId = order.id;

  // Create both threads upfront
  const orgThread = await prisma.orderThread.create({
    data: { orderId, side: 'org', lastMessageAt: new Date() }
  });
  orgThreadId = orgThread.id;

  const partnerThread = await prisma.orderThread.create({
    data: { orderId, side: 'partner', lastMessageAt: new Date() }
  });
  partnerThreadId = partnerThread.id;
}

async function cleanupData() {
  await prisma.message.deleteMany({
    where: { thread: { order: { title: ORDER_TITLE } } }
  });
  await prisma.threadReadState.deleteMany({
    where: { thread: { order: { title: ORDER_TITLE } } }
  });
  await prisma.orderThread.deleteMany({
    where: { order: { title: ORDER_TITLE } }
  });
  await prisma.order.deleteMany({ where: { title: ORDER_TITLE } });
  await prisma.organizationUser.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { externalId: ORG_EXT_ID } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { slug: PARTNER_SLUG } });

  const userEmails = [
    `${PREFIX}-manager@test.local`,
    `${PREFIX}-orguser@test.local`
  ];
  const staleUsers = await prisma.user.findMany({
    where: { email: { in: userEmails } },
    select: { id: true }
  });
  const staleIds = staleUsers.map((u) => u.id);
  if (managerId && !staleIds.includes(managerId)) staleIds.push(managerId);
  if (orgUserId && !staleIds.includes(orgUserId)) staleIds.push(orgUserId);
  if (staleIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: staleIds } } });
  }
}

beforeEach(async () => {
  if (companyId) await cleanupData();
  await seedData();
});

afterAll(async () => {
  await cleanupData();
  await prisma.$disconnect();
});

describe('listThreads scoping', () => {
  it('manager sees BOTH threads', async () => {
    // Seed a message on each side
    await prisma.message.create({
      data: { threadId: orgThreadId, authorId: managerId, body: 'Org-side msg' }
    });
    await prisma.message.create({
      data: { threadId: partnerThreadId, authorId: managerId, body: 'Partner-side msg' }
    });

    const result = await listThreads(prisma, managerSession);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain(orgThreadId);
    expect(ids).toContain(partnerThreadId);
  });

  it('organization member sees ONLY the org-side thread', async () => {
    await prisma.message.create({
      data: { threadId: orgThreadId, authorId: managerId, body: 'Org-side msg' }
    });
    await prisma.message.create({
      data: { threadId: partnerThreadId, authorId: managerId, body: 'Partner-side msg' }
    });

    const result = await listThreads(prisma, orgSession);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain(orgThreadId);
    expect(ids).not.toContain(partnerThreadId);
  });

  it('partner (matching partnerId) sees ONLY the partner-side thread', async () => {
    await prisma.message.create({
      data: { threadId: orgThreadId, authorId: managerId, body: 'Org-side msg' }
    });
    await prisma.message.create({
      data: { threadId: partnerThreadId, authorId: managerId, body: 'Partner-side msg' }
    });

    const result = await listThreads(prisma, partnerSession);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const ids = result.rows.map((r) => r.id);
    expect(ids).toContain(partnerThreadId);
    expect(ids).not.toContain(orgThreadId);
  });
});

describe('markRead / unreadCount', () => {
  it('team sends on org side → org member sees unread=true and unreadCount ≥ 1; after markRead → not unread', async () => {
    // Advance lastMessageAt so it's definitely after any read state
    await prisma.orderThread.update({
      where: { id: orgThreadId },
      data: { lastMessageAt: new Date() }
    });

    // Verify unread before markRead
    const countBefore = await unreadCount(prisma, orgSession);
    expect(countBefore.ok).toBe(true);
    if (!countBefore.ok) throw new Error('expected ok');
    expect(countBefore.count).toBeGreaterThanOrEqual(1);

    const threadsBefore = await listThreads(prisma, orgSession);
    expect(threadsBefore.ok).toBe(true);
    if (!threadsBefore.ok) throw new Error('expected ok');
    const orgRow = threadsBefore.rows.find((r) => r.id === orgThreadId);
    expect(orgRow).toBeDefined();
    expect(orgRow!.unread).toBe(true);

    // Mark read
    const markResult = await markRead(prisma, orgSession, orgThreadId);
    expect(markResult).toEqual({ ok: true });

    // Verify unread after markRead
    const countAfter = await unreadCount(prisma, orgSession);
    expect(countAfter.ok).toBe(true);
    if (!countAfter.ok) throw new Error('expected ok');
    expect(countAfter.count).toBeLessThan(countBefore.count);

    const threadsAfter = await listThreads(prisma, orgSession);
    expect(threadsAfter.ok).toBe(true);
    if (!threadsAfter.ok) throw new Error('expected ok');
    const orgRowAfter = threadsAfter.rows.find((r) => r.id === orgThreadId);
    expect(orgRowAfter?.unread).toBe(false);
  });
});

describe('listMessages', () => {
  it('returns messages in ascending createdAt order', async () => {
    // Insert with tiny delay via manual timestamps
    const t1 = new Date(Date.now() - 5000);
    const t2 = new Date(Date.now() - 2000);
    await prisma.message.create({
      data: { threadId: orgThreadId, authorId: managerId, body: 'First', createdAt: t1 }
    });
    await prisma.message.create({
      data: { threadId: orgThreadId, authorId: managerId, body: 'Second', createdAt: t2 }
    });

    const result = await listMessages(prisma, managerSession, { threadId: orgThreadId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].body).toBe('First');
    expect(result.rows[1].body).toBe('Second');
  });

  it('after filter excludes older messages', async () => {
    const t1 = new Date(Date.now() - 5000);
    const t2 = new Date(Date.now() - 2000);
    await prisma.message.create({
      data: { threadId: orgThreadId, authorId: managerId, body: 'Old', createdAt: t1 }
    });
    await prisma.message.create({
      data: { threadId: orgThreadId, authorId: managerId, body: 'New', createdAt: t2 }
    });

    const result = await listMessages(prisma, managerSession, {
      threadId: orgThreadId,
      after: t1.toISOString()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].body).toBe('New');
  });

  it('partner requesting org-side thread → forbidden', async () => {
    const result = await listMessages(prisma, partnerSession, { threadId: orgThreadId });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('bogus threadId → thread_not_found', async () => {
    const result = await listMessages(prisma, managerSession, { threadId: 'nonexistent-id' });
    expect(result).toEqual({ ok: false, error: 'thread_not_found' });
  });
});
