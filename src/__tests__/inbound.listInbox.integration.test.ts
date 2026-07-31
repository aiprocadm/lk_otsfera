import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listInbox } from '@/lib/services/inbound/listInbox';

/**
 * Integration coverage for the company-scoped staff inbox (Task 11a).
 *
 * Seeds two companies (A, B) each with a bound InboundMessage, plus one
 * shared unresolved (companyId=null) message. A manager session scoped to
 * company A must see A's bound message AND the unresolved one, and must
 * NEVER see company B's bound message. Also exercises `channel`/`status`
 * filter narrowing.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let companyA: string;
let companyB: string;
let msgBoundA: string;
let msgBoundB: string;
let msgUnresolved: string;
let managerA: SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();

  const cA = await prisma.company.create({ data: { name: `inboxCoA-${STAMP}` } });
  companyA = cA.id;
  const cB = await prisma.company.create({ data: { name: `inboxCoB-${STAMP}` } });
  companyB = cB.id;

  const mA = await prisma.inboundMessage.create({
    data: {
      channel: 'telegram',
      externalId: `inbox:test:a:${STAMP}`,
      senderRef: `sender-a-${STAMP}`,
      body: 'bound to company A',
      companyId: companyA,
      status: 'bound',
    },
  });
  msgBoundA = mA.id;

  const mB = await prisma.inboundMessage.create({
    data: {
      channel: 'telegram',
      externalId: `inbox:test:b:${STAMP}`,
      senderRef: `sender-b-${STAMP}`,
      body: 'bound to company B',
      companyId: companyB,
      status: 'bound',
    },
  });
  msgBoundB = mB.id;

  const mU = await prisma.inboundMessage.create({
    data: {
      channel: 'email',
      externalId: `inbox:test:u:${STAMP}`,
      senderRef: `sender-u-${STAMP}`,
      body: 'unresolved triage queue item',
      companyId: null,
      status: 'unresolved',
    },
  });
  msgUnresolved = mU.id;

  managerA = {
    sub: `mgr-${STAMP}`,
    role: 'manager',
    companyId: companyA,
  } as unknown as SessionPayload;
});

afterAll(async () => {
  await prisma.inboundMessage.deleteMany({
    where: { id: { in: [msgBoundA, msgBoundB, msgUnresolved] } },
  });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('listInbox — company-scoped staff inbox (C8)', () => {
  it('manager of company A sees A-bound + unresolved, never B-bound', async () => {
    const result = await listInbox(prisma, managerA);
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(msgBoundA);
    expect(ids).toContain(msgUnresolved);
    expect(ids).not.toContain(msgBoundB);
  });

  it('channel filter narrows to matching channel only', async () => {
    const result = await listInbox(prisma, managerA, { channel: 'email' });
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(msgUnresolved);
    expect(ids).not.toContain(msgBoundA);
    expect(ids).not.toContain(msgBoundB);
  });

  it('status filter narrows to bound only (still company-scoped)', async () => {
    const result = await listInbox(prisma, managerA, { status: 'bound' });
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(msgBoundA);
    expect(ids).not.toContain(msgUnresolved);
    expect(ids).not.toContain(msgBoundB);
  });

  it('status filter for unresolved excludes bound messages', async () => {
    const result = await listInbox(prisma, managerA, { status: 'unresolved' });
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(msgUnresolved);
    expect(ids).not.toContain(msgBoundA);
    expect(ids).not.toContain(msgBoundB);
  });

  it('orgId filter narrows to messages resolved to that organization', async () => {
    const org = await prisma.organization.create({
      data: { name: `inboxOrg-${STAMP}`, companyId: companyA },
    });
    const mOrg = await prisma.inboundMessage.create({
      data: {
        channel: 'telegram',
        externalId: `inbox:test:org:${STAMP}`,
        senderRef: `sender-org-${STAMP}`,
        body: 'bound to a specific org',
        companyId: companyA,
        resolvedOrgId: org.id,
        status: 'bound',
      },
    });
    try {
      const result = await listInbox(prisma, managerA, { orgId: org.id });
      const ids = result.items.map((i) => i.id);
      expect(ids).toEqual([mOrg.id]);
    } finally {
      await prisma.inboundMessage.delete({ where: { id: mOrg.id } });
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it('total is consistent with items and excludes the other company scope', async () => {
    const result = await listInbox(prisma, managerA);
    expect(result.total).toBeGreaterThanOrEqual(result.items.length);
    expect(result.total).toBeGreaterThanOrEqual(2); // at least A-bound + unresolved

    // Symmetry check: company B's manager sees only B's bound row, not A's.
    const managerB = {
      sub: `mgr-b-${STAMP}`,
      role: 'manager',
      companyId: companyB,
    } as unknown as SessionPayload;
    const bResult = await listInbox(prisma, managerB, { status: 'bound' });
    const bIds = bResult.items.map((i) => i.id);
    expect(bIds).toContain(msgBoundB);
    expect(bIds).not.toContain(msgBoundA);
  });
});
