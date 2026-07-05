import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listCalls } from '@/lib/services/telephony/listCalls';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const STAMP = `tlc${Date.now()}`;

function managerSession(companyId: string | null): SessionPayload {
  return {
    sub: `${STAMP}-mgr`,
    role: 'manager',
    email: 'mgr@local',
    companyId: companyId ?? undefined,
    managedOrgIds: [],
  } as unknown as SessionPayload;
}

describe('listCalls (C8 company-scope)', () => {
  let companyA: { id: string };
  let companyB: { id: string };
  let callA: { id: string };
  let callB: { id: string };
  let callUnresolved: { id: string };

  beforeAll(async () => {
    companyA = await prisma.company.create({ data: { name: `${STAMP}-coA` } });
    companyB = await prisma.company.create({ data: { name: `${STAMP}-coB` } });

    callA = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:a`,
        direction: 'inbound',
        callerNumber: '+79990001111',
        status: 'completed',
        companyId: companyA.id,
      },
    });
    callB = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:b`,
        direction: 'outbound',
        callerNumber: '+79990002222',
        status: 'completed',
        companyId: companyB.id,
      },
    });
    callUnresolved = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:u`,
        direction: 'inbound',
        callerNumber: '+79990003333',
        status: 'completed',
        companyId: null,
      },
    });
  });

  afterAll(async () => {
    await prisma.call.deleteMany({ where: { externalId: { startsWith: STAMP } } });
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } });
  });

  it("manager A sees company A's call + the unresolved one, not company B's", async () => {
    const result = await listCalls(prisma, managerSession(companyA.id));
    const ids = result.items.map((c) => c.id);
    expect(ids).toContain(callA.id);
    expect(ids).toContain(callUnresolved.id);
    expect(ids).not.toContain(callB.id);
  });

  it("manager B sees company B's call + the unresolved one, not company A's", async () => {
    const result = await listCalls(prisma, managerSession(companyB.id));
    const ids = result.items.map((c) => c.id);
    expect(ids).toContain(callB.id);
    expect(ids).toContain(callUnresolved.id);
    expect(ids).not.toContain(callA.id);
  });

  it('a companyId-less session sees only the unresolved bucket (sentinel denies the company branch)', async () => {
    const result = await listCalls(prisma, managerSession(null));
    const ids = result.items.map((c) => c.id);
    expect(ids).toContain(callUnresolved.id);
    expect(ids).not.toContain(callA.id);
    expect(ids).not.toContain(callB.id);
  });

  it('direction filter narrows results within scope', async () => {
    const result = await listCalls(prisma, managerSession(companyA.id), { direction: 'inbound' });
    const ids = result.items.map((c) => c.id);
    expect(ids).toContain(callA.id);
    expect(ids).toContain(callUnresolved.id);

    const outboundResult = await listCalls(prisma, managerSession(companyA.id), { direction: 'outbound' });
    expect(outboundResult.items.map((c) => c.id)).not.toContain(callA.id);
  });

  it('maps recordingPath presence to hasRecording without leaking the raw path', async () => {
    const withRecording = await prisma.call.create({
      data: {
        provider: 'mango',
        externalId: `${STAMP}:rec`,
        direction: 'inbound',
        callerNumber: '+79990004444',
        status: 'completed',
        companyId: companyA.id,
        recordingPath: 'calls/some-private-path.mp3',
        recordingScanStatus: 'clean',
      },
    });
    try {
      const result = await listCalls(prisma, managerSession(companyA.id));
      const item = result.items.find((c) => c.id === withRecording.id);
      expect(item).toBeDefined();
      expect(item?.hasRecording).toBe(true);
      expect(item).not.toHaveProperty('recordingPath');
    } finally {
      await prisma.call.delete({ where: { id: withRecording.id } });
    }
  });
});
