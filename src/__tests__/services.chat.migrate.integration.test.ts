import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { migrateCommentsToMessages } from '@/lib/services/chat/migrate';

// new PrismaClient() auto-marks this as integration-mode (see vitest.config.ts)
const prisma = new PrismaClient();

const PREFIX = 'chat-migrate-it';
const PARTNER_SLUG = `${PREFIX}-partner`;
const ORG_EXT_ID = `${PREFIX}-org`;
const ORDER_TITLE = `${PREFIX}-order`;

let partnerId: string;
let organizationId: string;
let companyId: string;
let orderId: string;
let orgUserId: string;
let partnerUserId: string;
let managerUserId: string;

async function seedData() {
  const partner = await prisma.partner.create({
    data: { name: `${PREFIX}-Partner`, slug: PARTNER_SLUG, commissionRate: 0.1 },
  });
  partnerId = partner.id;

  const company = await prisma.company.create({
    data: { name: `${PREFIX}-Company` },
  });
  companyId = company.id;

  const org = await prisma.organization.create({
    data: {
      name: `${PREFIX}-Org`,
      externalId: ORG_EXT_ID,
      partnerId,
      companyId,
    },
  });
  organizationId = org.id;

  const order = await prisma.order.create({
    data: {
      title: ORDER_TITLE,
      partnerId,
      organizationId,
      companyId,
    },
  });
  orderId = order.id;

  const orgUser = await prisma.user.create({
    data: {
      email: `${PREFIX}-orguser@test.local`,
      name: `${PREFIX}-OrgUser`,
      role: 'organization',
      isActive: true,
    },
  });
  orgUserId = orgUser.id;

  const partnerUser = await prisma.user.create({
    data: {
      email: `${PREFIX}-partneruser@test.local`,
      name: `${PREFIX}-PartnerUser`,
      role: 'partner',
      isActive: true,
    },
  });
  partnerUserId = partnerUser.id;

  const managerUser = await prisma.user.create({
    data: {
      email: `${PREFIX}-manager@test.local`,
      name: `${PREFIX}-Manager`,
      role: 'manager',
      isActive: true,
    },
  });
  managerUserId = managerUser.id;

  // Comments in ascending time order:
  // (1) org user "q1" — side 'org'
  // (2) manager "a1" — inherits 'org' (last external was org)
  // (3) partner user "p1" — side 'partner'; has attachmentPath
  // (4) manager "a2" — inherits 'partner' (last external was partner)
  const base = new Date('2026-01-01T10:00:00.000Z');
  const t = (offsetMs: number) => new Date(base.getTime() + offsetMs);

  await prisma.comment.create({
    data: {
      orderId,
      authorId: orgUserId,
      body: 'q1',
      createdAt: t(0),
    },
  });

  await prisma.comment.create({
    data: {
      orderId,
      authorId: managerUserId,
      body: 'a1',
      createdAt: t(1000),
    },
  });

  await prisma.comment.create({
    data: {
      orderId,
      authorId: partnerUserId,
      body: 'p1',
      attachmentPath: 'uploads/test-attach.pdf',
      createdAt: t(2000),
    },
  });

  await prisma.comment.create({
    data: {
      orderId,
      authorId: managerUserId,
      body: 'a2',
      createdAt: t(3000),
    },
  });
}

async function cleanupData() {
  // FK-safe order: message → threadReadState → orderThread → comment → order → org → company → partner → users
  await prisma.message.deleteMany({
    where: { thread: { order: { title: ORDER_TITLE } } },
  });
  await prisma.threadReadState.deleteMany({
    where: { thread: { order: { title: ORDER_TITLE } } },
  });
  await prisma.orderThread.deleteMany({
    where: { order: { title: ORDER_TITLE } },
  });
  await prisma.comment.deleteMany({ where: { order: { title: ORDER_TITLE } } });
  await prisma.order.deleteMany({ where: { title: ORDER_TITLE } });
  await prisma.organization.deleteMany({ where: { externalId: ORG_EXT_ID } });
  // company must be deleted AFTER all orders referencing it are gone
  await prisma.company.deleteMany({ where: { name: `${PREFIX}-Company` } });
  await prisma.partner.deleteMany({ where: { slug: PARTNER_SLUG } });

  const emailsToClean = [
    `${PREFIX}-orguser@test.local`,
    `${PREFIX}-partneruser@test.local`,
    `${PREFIX}-manager@test.local`,
  ];
  const staleUsers = await prisma.user.findMany({
    where: { email: { in: emailsToClean } },
    select: { id: true },
  });
  const staleIds = staleUsers.map((u) => u.id);
  if (staleIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: staleIds } } });
  }
}

afterAll(async () => {
  await cleanupData();
  await prisma.$disconnect();
});

describe('migrateCommentsToMessages integration', () => {
  it('migrates 4 comments into the correct threads with correct side heuristic', async () => {
    // Clean any leftovers then seed fresh
    await cleanupData();
    await seedData();

    const result = await migrateCommentsToMessages(prisma);

    expect(result.migrated).toBe(4);
    expect(result.skipped).toBe(0);

    // Org thread: messages "q1" (org user) and "a1" (manager → inherited org side)
    const orgThread = await prisma.orderThread.findUnique({
      where: { orderId_side: { orderId, side: 'org' } },
    });
    expect(orgThread).not.toBeNull();

    const orgMessages = await prisma.message.findMany({
      where: { threadId: orgThread!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(orgMessages).toHaveLength(2);
    expect(orgMessages[0].body).toBe('q1');
    expect(orgMessages[0].authorId).toBe(orgUserId);
    expect(orgMessages[1].body).toBe('a1');
    expect(orgMessages[1].authorId).toBe(managerUserId);

    // Partner thread: messages "p1" (partner user) and "a2" (manager → inherited partner side)
    const partnerThread = await prisma.orderThread.findUnique({
      where: { orderId_side: { orderId, side: 'partner' } },
    });
    expect(partnerThread).not.toBeNull();

    const partnerMessages = await prisma.message.findMany({
      where: { threadId: partnerThread!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(partnerMessages).toHaveLength(2);
    expect(partnerMessages[0].body).toBe('p1');
    expect(partnerMessages[0].authorId).toBe(partnerUserId);
    expect(partnerMessages[1].body).toBe('a2');
    expect(partnerMessages[1].authorId).toBe(managerUserId);

    // attachmentPath preserved on the partner "p1" message
    expect(partnerMessages[0].attachmentPath).toBe('uploads/test-attach.pdf');

    // createdAt preserved — matches the base comment times
    const base = new Date('2026-01-01T10:00:00.000Z');
    expect(orgMessages[0].createdAt.getTime()).toBe(base.getTime());
    expect(orgMessages[1].createdAt.getTime()).toBe(base.getTime() + 1000);
    expect(partnerMessages[0].createdAt.getTime()).toBe(base.getTime() + 2000);
    expect(partnerMessages[1].createdAt.getTime()).toBe(base.getTime() + 3000);

    // thread.lastMessageAt equals the latest migrated comment's createdAt for each thread
    // org thread last message is "a1" at base+1000
    expect(orgThread!.lastMessageAt.getTime()).toBe(base.getTime() + 1000);
    // partner thread last message is "a2" at base+3000
    // (need to re-fetch to get the updated value)
    const partnerThreadUpdated = await prisma.orderThread.findUnique({
      where: { orderId_side: { orderId, side: 'partner' } },
    });
    expect(partnerThreadUpdated!.lastMessageAt.getTime()).toBe(base.getTime() + 3000);
  });

  it('idempotency: second run returns migrated:0, skipped:4, message counts unchanged', async () => {
    // Self-contained: seed fresh so this test does not depend on the previous test's state.
    await cleanupData();
    await seedData();

    const first = await migrateCommentsToMessages(prisma);
    expect(first.migrated).toBe(4);

    const countAfterFirst = await prisma.message.count({
      where: { thread: { order: { title: ORDER_TITLE } } },
    });

    const second = await migrateCommentsToMessages(prisma);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(4);

    // Scoped message count must be unchanged by the second (no-op) run.
    const countAfterSecond = await prisma.message.count({
      where: { thread: { order: { title: ORDER_TITLE } } },
    });
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
