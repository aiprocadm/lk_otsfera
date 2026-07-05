import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ingestCallEvent } from '@/lib/services/telephony/ingestCall';
import type { MangoEvent } from '@/lib/telephony/mango/parse';

const prisma = new PrismaClient();
const STAMP = `tic${Date.now()}`;

async function cleanup() {
  await prisma.call.deleteMany({ where: { externalId: { startsWith: STAMP } } });
}

describe('ingestCallEvent', () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it('idempotent upsert: two identical summary events → 1 row', async () => {
    const externalId = `${STAMP}:idem`;
    const event: MangoEvent = {
      kind: 'summary',
      externalId,
      direction: 'inbound',
      callerNumber: '+79990001111',
      durationSec: 42,
      status: 'completed',
    };
    const r1 = await ingestCallEvent(prisma, event);
    const r2 = await ingestCallEvent(prisma, event);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.id).toBe(r2.id);
    const rows = await prisma.call.findMany({ where: { externalId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].durationSec).toBe(42);
  });

  it('merge: a call event then a summary event for the same externalId → one row, summary direction/duration wins', async () => {
    const externalId = `${STAMP}:merge`;
    const callEvent: MangoEvent = {
      kind: 'call',
      externalId,
      direction: 'outbound',
      callerNumber: '+79990002222',
      status: 'ringing',
    };
    const summaryEvent: MangoEvent = {
      kind: 'summary',
      externalId,
      direction: 'inbound',
      callerNumber: '+79990002222',
      durationSec: 77,
      status: 'completed',
    };
    const r1 = await ingestCallEvent(prisma, callEvent);
    const r2 = await ingestCallEvent(prisma, summaryEvent);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.id).toBe(r2.id);
    const rows = await prisma.call.findMany({ where: { externalId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('inbound');
    expect(rows[0].durationSec).toBe(77);
    expect(rows[0].status).toBe('completed');
  });

  it('out-of-order: a call event AFTER an authoritative summary does NOT clobber it', async () => {
    const externalId = `${STAMP}:reorder`;
    const summaryEvent: MangoEvent = {
      kind: 'summary',
      externalId,
      direction: 'outbound',
      callerNumber: '+79990005555',
      durationSec: 99,
      status: 'completed',
    };
    const lateCallEvent: MangoEvent = {
      kind: 'call',
      externalId,
      direction: 'inbound',
      callerNumber: '+79990005555',
      status: 'ringing',
    };
    const r1 = await ingestCallEvent(prisma, summaryEvent);
    const r2 = await ingestCallEvent(prisma, lateCallEvent);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.id).toBe(r2.id);
    const rows = await prisma.call.findMany({ where: { externalId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('outbound');
    expect(rows[0].status).toBe('completed');
    expect(rows[0].durationSec).toBe(99);
  });

  it('resolved caller sets companyId from a seeded User/Org', async () => {
    const company = await prisma.company.create({ data: { name: `${STAMP}-co` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId: company.id } });
    const user = await prisma.user.create({
      data: {
        email: `${STAMP}-user@t.local`,
        name: 'U',
        role: 'organization',
        organizationId: org.id,
        whatsappPhone: '+79990003333',
      },
    });
    const externalId = `${STAMP}:resolved`;
    try {
      const r = await ingestCallEvent(prisma, {
        kind: 'summary',
        externalId,
        direction: 'inbound',
        callerNumber: '+79990003333',
        durationSec: 10,
        status: 'completed',
      });
      expect(r.ok).toBe(true);
      const row = await prisma.call.findUnique({ where: { id: (r as any).id } });
      expect(row?.companyId).toBe(company.id);
      expect(row?.resolvedOrgId).toBe(org.id);
      expect(row?.resolvedUserId).toBe(user.id);
    } finally {
      await prisma.call.deleteMany({ where: { externalId } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.company.delete({ where: { id: company.id } });
    }
  });

  it('unresolved caller → companyId null', async () => {
    const externalId = `${STAMP}:unresolved`;
    const r = await ingestCallEvent(prisma, {
      kind: 'summary',
      externalId,
      direction: 'inbound',
      callerNumber: '+79990009999',
      status: 'completed',
    });
    expect(r.ok).toBe(true);
    const row = await prisma.call.findFirst({ where: { externalId } });
    expect(row?.companyId).toBeNull();
  });

  it('recording event → needsRecording:true and recordingId set (creates placeholder row if none exists)', async () => {
    const externalId = `${STAMP}:recording`;
    const r = await ingestCallEvent(prisma, { kind: 'recording', externalId, recordingId: 'rec-abc-123' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.needsRecording).toBe(true);
    const row = await prisma.call.findFirst({ where: { externalId } });
    expect(row?.recordingId).toBe('rec-abc-123');
  });

  it('recording event onto an existing call row just sets recordingId, does not clobber other fields', async () => {
    const externalId = `${STAMP}:recording-merge`;
    await ingestCallEvent(prisma, {
      kind: 'summary',
      externalId,
      direction: 'outbound',
      callerNumber: '+79990004444',
      durationSec: 15,
      status: 'completed',
    });
    const r = await ingestCallEvent(prisma, { kind: 'recording', externalId, recordingId: 'rec-xyz-999' });
    expect(r.ok).toBe(true);
    const rows = await prisma.call.findMany({ where: { externalId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].recordingId).toBe('rec-xyz-999');
    expect(rows[0].direction).toBe('outbound');
    expect(rows[0].durationSec).toBe(15);
  });

  it('call-first event with missing fields does not violate NOT NULL columns', async () => {
    const externalId = `${STAMP}:call-first`;
    const r = await ingestCallEvent(prisma, { kind: 'call', externalId });
    expect(r.ok).toBe(true);
    const row = await prisma.call.findFirst({ where: { externalId } });
    expect(row?.direction).toBe('inbound');
    expect(row?.callerNumber).toBe('');
    expect(row?.status).toBe('in_progress');
  });
});
