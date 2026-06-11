import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { findOrCreateThread } from '@/lib/services/chat/threads';

// new PrismaClient() auto-marks this as integration-mode (see vitest.config.ts)
const prisma = new PrismaClient();

const PREFIX = 'chat-it';
const PARTNER_SLUG = `${PREFIX}-partner`;
const ORG_EXT_ID = `${PREFIX}-org`;
const ORDER_TITLE = `${PREFIX}-order`;

let partnerId: string;
let organizationId: string;
let companyId: string;
let orderId: string;

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

  const order = await prisma.order.create({
    data: {
      title: ORDER_TITLE,
      partnerId,
      organizationId,
      companyId
    }
  });
  orderId = order.id;
}

async function cleanupData() {
  // FK-safe order: message → threadReadState → orderThread → order → org → company → partner
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
  await prisma.organization.deleteMany({ where: { externalId: ORG_EXT_ID } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.partner.deleteMany({ where: { slug: PARTNER_SLUG } });
}

beforeEach(async () => {
  // Clean then re-seed so each test starts fresh
  if (companyId) await cleanupData();
  await seedData();
});

afterAll(async () => {
  await cleanupData();
  await prisma.$disconnect();
});

// Manager chat visibility is company-scoped (C8) — the session must carry the
// seeded companyId, which only exists after beforeEach, hence a factory.
const teamSession = (): SessionPayload => ({ sub: 'mgr1', role: 'manager', companyId });

describe('findOrCreateThread', () => {
  it('idempotency: calling twice returns the same thread, only one row in DB', async () => {
    const first = await findOrCreateThread(prisma, teamSession(), { orderId, side: 'org' });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected ok');

    const second = await findOrCreateThread(prisma, teamSession(), { orderId, side: 'org' });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('expected ok');

    // Same thread id
    expect(second.thread.id).toBe(first.thread.id);

    // Exactly one row for this (orderId, side) pair
    const count = await prisma.orderThread.count({ where: { orderId, side: 'org' } });
    expect(count).toBe(1);
  });

  it('forbidden: partner session with wrong partnerId requesting org side', async () => {
    // Create a second partner not related to this order
    const otherPartner = await prisma.partner.create({
      data: { name: `${PREFIX}-OtherPartner`, commissionRate: 0 }
    });

    const otherPartnerSession: SessionPayload = {
      sub: 'other-partner-user',
      role: 'partner',
      partnerId: otherPartner.id
    };

    const result = await findOrCreateThread(prisma, otherPartnerSession, {
      orderId,
      side: 'org'
    });
    expect(result).toEqual({ ok: false, error: 'forbidden' });

    // Cleanup the extra partner
    await prisma.partner.delete({ where: { id: otherPartner.id } });
  });

  it('order_not_found: bogus orderId returns error', async () => {
    const result = await findOrCreateThread(prisma, teamSession(), {
      orderId: 'nonexistent-order-id-xyz',
      side: 'org'
    });
    expect(result).toEqual({ ok: false, error: 'order_not_found' });
  });
});
