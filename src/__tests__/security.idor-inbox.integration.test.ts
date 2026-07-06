import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { listInbox } from '@/lib/services/inbound/listInbox';

/**
 * Security regression (Task 11a) — cross-company isolation of the staff
 * inbox (`listInbox`). C8 invariant: bound inbound messages are visible
 * ONLY within the manager's own company. A manager of company A must NEVER
 * see company B's bound inbound message, in either the item list or the
 * `total` count. This is the load-bearing IDOR test for this read path.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let companyA: string;
let companyB: string;
let msgBoundA: string;
let msgBoundB: string;
let managerA: SessionPayload;

beforeAll(async () => {
  prisma = new PrismaClient();

  const cA = await prisma.company.create({ data: { name: `idorInboxCoA-${STAMP}` } });
  companyA = cA.id;
  const cB = await prisma.company.create({ data: { name: `idorInboxCoB-${STAMP}` } });
  companyB = cB.id;

  const mA = await prisma.inboundMessage.create({
    data: {
      channel: 'telegram',
      externalId: `idor:inbox:a:${STAMP}`,
      senderRef: `idor-sender-a-${STAMP}`,
      body: 'A secret bound message',
      companyId: companyA,
      status: 'bound',
    },
  });
  msgBoundA = mA.id;

  const mB = await prisma.inboundMessage.create({
    data: {
      channel: 'telegram',
      externalId: `idor:inbox:b:${STAMP}`,
      senderRef: `idor-sender-b-${STAMP}`,
      body: 'B secret bound message',
      companyId: companyB,
      status: 'bound',
    },
  });
  msgBoundB = mB.id;

  managerA = { sub: `idor-mgr-${STAMP}`, role: 'manager', companyId: companyA } as unknown as SessionPayload;
});

afterAll(async () => {
  await prisma.inboundMessage.deleteMany({ where: { id: { in: [msgBoundA, msgBoundB] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('IDOR — listInbox must never leak another company\'s bound inbound messages', () => {
  it('manager of company A does not receive company B\'s bound message in items', async () => {
    const result = await listInbox(prisma, managerA);
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain(msgBoundA); // positive control — filter is not vacuous
    expect(ids).not.toContain(msgBoundB); // the leak under test
  });

  it('total excludes company B\'s bound message even when filtering by status=bound', async () => {
    const result = await listInbox(prisma, managerA, { status: 'bound' });
    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual([msgBoundA]);
    expect(result.total).toBe(1);
  });

  it('a companyId-less manager session sees no bound messages from any company (sentinel deny-all)', async () => {
    const noCompanySession = { sub: `idor-mgr-nc-${STAMP}`, role: 'manager', companyId: null } as unknown as SessionPayload;
    const result = await listInbox(prisma, noCompanySession, { status: 'bound' });
    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain(msgBoundA);
    expect(ids).not.toContain(msgBoundB);
    expect(result.total).toBe(0);
  });
});
