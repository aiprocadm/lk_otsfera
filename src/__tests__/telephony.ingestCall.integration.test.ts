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

  it('call-событие с резолвнутым звонящим тоже связывает org/company (не только summary)', async () => {
    const company = await prisma.company.create({ data: { name: `${STAMP}-co2` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-org2`, companyId: company.id } });
    const user = await prisma.user.create({
      data: {
        email: `${STAMP}-user2@t.local`,
        name: 'U2',
        role: 'organization',
        organizationId: org.id,
        whatsappPhone: '+79990004444',
      },
    });
    const externalId = `${STAMP}:call-resolved`;
    try {
      const r = await ingestCallEvent(prisma, {
        kind: 'call',
        externalId,
        callerNumber: '+79990004444',
        status: 'in_progress',
      });
      expect(r.ok).toBe(true);
      const row = await prisma.call.findFirst({ where: { externalId } });
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

  it('lead-резолв (звонящий известен только по лиду): resolvedUserId=null, status-дефолты', async () => {
    const company = await prisma.company.create({ data: { name: `${STAMP}-co3` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-org3`, companyId: company.id } });
    const partner = await prisma.partner.create({ data: { name: `${STAMP}-p3` } });
    const creator = await prisma.user.create({
      data: { email: `${STAMP}-creator@t.local`, name: 'C', role: 'partner', partnerId: partner.id },
    });
    const lead = await prisma.lead.create({
      data: {
        partnerId: partner.id,
        createdByUserId: creator.id,
        organizationId: org.id,
        clientCompanyName: 'Клиент',
        clientContactName: 'Контакт',
        clientContactPhone: '+79990005555',
        subject: 'звонок',
      },
    });
    const extSummary = `${STAMP}:lead-summary`;
    const extCall = `${STAMP}:lead-call`;
    try {
      // summary без status: create-путь берёт дефолт 'completed', resolvedUserId — null (лид без user)
      const r1 = await ingestCallEvent(prisma, {
        kind: 'summary', externalId: extSummary, direction: 'inbound', callerNumber: '+79990005555',
      });
      expect(r1.ok).toBe(true);
      let row = await prisma.call.findFirst({ where: { externalId: extSummary } });
      expect(row?.resolvedOrgId).toBe(org.id);
      expect(row?.resolvedUserId).toBeNull();
      expect(row?.companyId).toBe(company.id);
      expect(row?.status).toBe('completed');

      // replay того же summary — update-путь с теми же дефолтами
      await ingestCallEvent(prisma, {
        kind: 'summary', externalId: extSummary, direction: 'inbound', callerNumber: '+79990005555',
      });
      row = await prisma.call.findFirst({ where: { externalId: extSummary } });
      expect(row?.status).toBe('completed');

      // call-событие с lead-резолвом — та же ?? null-ветка в call-ветке
      const r2 = await ingestCallEvent(prisma, {
        kind: 'call', externalId: extCall, callerNumber: '+79990005555',
      });
      expect(r2.ok).toBe(true);
      const callRow = await prisma.call.findFirst({ where: { externalId: extCall } });
      expect(callRow?.resolvedOrgId).toBe(org.id);
      expect(callRow?.resolvedUserId).toBeNull();
    } finally {
      await prisma.call.deleteMany({ where: { externalId: { in: [extSummary, extCall] } } });
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.user.delete({ where: { id: creator.id } });
      await prisma.partner.delete({ where: { id: partner.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.company.delete({ where: { id: company.id } });
    }
  });

  it('contact-first resolution (M2): summary event resolves via ContactChannel, sets Call.contactId', async () => {
    const company = await prisma.company.create({ data: { name: `${STAMP}-co4` } });
    const org = await prisma.organization.create({ data: { name: `${STAMP}-org4`, companyId: company.id } });
    const contact = await prisma.contact.create({
      data: {
        companyId: company.id,
        organizationId: org.id,
        name: `${STAMP}-contact4`,
        channels: {
          create: [{ companyId: company.id, type: 'phone', value: '+79990006666', normalizedValue: '+79990006666' }],
        },
      },
    });
    const externalId = `${STAMP}:contact-resolved`;
    try {
      const r = await ingestCallEvent(prisma, {
        kind: 'summary',
        externalId,
        direction: 'inbound',
        callerNumber: '+79990006666',
        durationSec: 20,
        status: 'completed',
      });
      expect(r.ok).toBe(true);
      const row = await prisma.call.findFirst({ where: { externalId } });
      expect(row?.contactId).toBe(contact.id);
      expect(row?.resolvedOrgId).toBe(org.id);
      expect(row?.companyId).toBe(company.id);
    } finally {
      await prisma.call.deleteMany({ where: { externalId } });
      await prisma.contactChannel.deleteMany({ where: { contactId: contact.id } });
      await prisma.contact.delete({ where: { id: contact.id } });
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
