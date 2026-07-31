import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { sendMessage } from '@/lib/services/chat/messages';

// new PrismaClient() auto-marks this as integration-mode (see vitest.config.ts)
const prisma = new PrismaClient();

const PREFIX = 'chat-msg-it';
const PARTNER_SLUG = `${PREFIX}-partner`;
const ORG_EXT_ID = `${PREFIX}-org`;
const ORDER_TITLE = `${PREFIX}-order`;

let partnerId: string;
let organizationId: string;
let companyId: string;
let orderId: string;
let managerId: string;

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

  const manager = await prisma.user.create({
    data: {
      email: `${PREFIX}-manager@test.local`,
      name: `${PREFIX}-Manager`,
      role: 'manager',
      isActive: true,
    },
  });
  managerId = manager.id;

  const order = await prisma.order.create({
    data: {
      title: ORDER_TITLE,
      partnerId,
      organizationId,
      companyId,
    },
  });
  orderId = order.id;
  // Manager chat visibility is company-scoped (C8) — session carries companyId.
  teamSession = { sub: managerId, role: 'manager', companyId };
}

async function cleanupData() {
  // FK-safe order: message → threadReadState → orderThread → order → org → company → partner → user
  await prisma.message.deleteMany({
    where: { thread: { order: { title: ORDER_TITLE } } },
  });
  await prisma.threadReadState.deleteMany({
    where: { thread: { order: { title: ORDER_TITLE } } },
  });
  await prisma.orderThread.deleteMany({
    where: { order: { title: ORDER_TITLE } },
  });
  await prisma.order.deleteMany({ where: { title: ORDER_TITLE } });
  await prisma.organization.deleteMany({ where: { externalId: ORG_EXT_ID } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { slug: PARTNER_SLUG } });
  // AuditLog and Notification reference userId — delete before the user row.
  // Also delete by email to handle stale rows from a failed previous run.
  const managerEmail = `${PREFIX}-manager@test.local`;
  const staleManagers = await prisma.user.findMany({
    where: { email: managerEmail },
    select: { id: true },
  });
  const staleIds = staleManagers.map((u) => u.id);
  if (managerId && !staleIds.includes(managerId)) staleIds.push(managerId);
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

// teamSession.sub is set to the seeded manager id in beforeEach
let teamSession: SessionPayload = { sub: '', role: 'manager' };

describe('sendMessage integration', () => {
  it('team sends on org side → message persisted, thread lastMessageAt advanced', async () => {
    const beforeSend = new Date();

    const result = await sendMessage(prisma, teamSession, {
      orderId,
      side: 'org',
      body: 'Hello from manager',
    });

    expect(result).toEqual({ ok: true, messageId: expect.any(String) });
    if (!result.ok) throw new Error('expected ok');

    // Message body is persisted
    const msg = await prisma.message.findFirst({
      where: { id: result.messageId },
    });
    expect(msg).not.toBeNull();
    expect(msg!.body).toBe('Hello from manager');
    expect(msg!.authorId).toBe(teamSession.sub);

    // Thread lastMessageAt is advanced past beforeSend
    const thread = await prisma.orderThread.findUnique({
      where: { orderId_side: { orderId, side: 'org' } },
    });
    expect(thread).not.toBeNull();
    expect(thread!.lastMessageAt!.getTime()).toBeGreaterThanOrEqual(beforeSend.getTime());
  });

  it('partner with wrong partnerId on org side → forbidden, no message row', async () => {
    const otherPartner = await prisma.partner.create({
      data: { name: `${PREFIX}-OtherPartner`, commissionRate: 0 },
    });

    const wrongPartnerSession: SessionPayload = {
      sub: 'wrong-partner-user',
      role: 'partner',
      partnerId: otherPartner.id,
    };

    const result = await sendMessage(prisma, wrongPartnerSession, {
      orderId,
      side: 'org',
      body: 'Should be blocked',
    });

    expect(result).toEqual({ ok: false, error: 'forbidden' });

    // No message row was created
    const count = await prisma.message.count({
      where: { thread: { orderId, side: 'org' } },
    });
    expect(count).toBe(0);

    // Cleanup extra partner
    await prisma.partner.delete({ where: { id: otherPartner.id } });
  });
});
