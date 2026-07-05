import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ingestInboundMessage } from '@/lib/services/inbound/ingest';

const { addMock } = vi.hoisted(() => ({ addMock: vi.fn() }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: addMock }) }));

const prisma = new PrismaClient();

describe('ingestInboundMessage', () => {
  beforeEach(async () => {
    await prisma.inboundMessage.deleteMany({ where: { externalId: { startsWith: 'tg:test:' } } });
    addMock.mockReset();
  });

  it('creates one row and is idempotent on replay', async () => {
    const dto = { channel: 'telegram' as const, externalId: 'tg:test:1', senderRef: '999', body: 'привет' };
    const r1 = await ingestInboundMessage(prisma, dto);
    expect(r1.ok).toBe(true);
    const r2 = await ingestInboundMessage(prisma, dto);
    expect(r2.ok).toBe(true);
    const rows = await prisma.inboundMessage.findMany({ where: { externalId: 'tg:test:1' } });
    expect(rows).toHaveLength(1);
  });

  it('unresolved sender → status unresolved, companyId null', async () => {
    const r = await ingestInboundMessage(prisma, {
      channel: 'telegram', externalId: 'tg:test:2', senderRef: 'unknown', body: 'x',
    });
    expect(r.ok).toBe(true);
    const row = await prisma.inboundMessage.findUnique({ where: { externalId: 'tg:test:2' } });
    expect(row?.status).toBe('unresolved');
    expect(row?.companyId).toBeNull();
  });

  it('exact match → status bound + companyId bound from resolver (scope binding)', async () => {
    const stamp = Date.now();
    const company = await prisma.company.create({ data: { name: `inb-co-${stamp}` } });
    const org = await prisma.organization.create({ data: { name: `inb-org-${stamp}`, companyId: company.id } });
    const user = await prisma.user.create({ data: { email: `inb-${stamp}@t.local`, name: 'U', role: 'organization', organizationId: org.id, telegramChatId: `tgc-${stamp}` } });
    try {
      const r = await ingestInboundMessage(prisma, { channel: 'telegram', externalId: `tg:test:bound:${stamp}`, senderRef: `tgc-${stamp}`, body: 'hi' });
      expect(r.ok).toBe(true);
      const row = await prisma.inboundMessage.findUnique({ where: { externalId: `tg:test:bound:${stamp}` } });
      expect(row?.status).toBe('bound');
      expect(row?.companyId).toBe(company.id);
      expect(row?.resolvedOrgId).toBe(org.id);
      expect(row?.resolvedUserId).toBe(user.id);
    } finally {
      await prisma.inboundMessage.deleteMany({ where: { externalId: `tg:test:bound:${stamp}` } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.company.delete({ where: { id: company.id } });
    }
  });

  it('concurrent duplicate delivery → single row (race handled, no throw)', async () => {
    const dto = { channel: 'telegram' as const, externalId: 'tg:test:race', senderRef: '888', body: 'race' };
    const [a, b] = await Promise.all([ingestInboundMessage(prisma, dto), ingestInboundMessage(prisma, dto)]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const rows = await prisma.inboundMessage.findMany({ where: { externalId: 'tg:test:race' } });
    expect(rows).toHaveLength(1);
  });

  it('ingest with attachmentPath → enqueues docs.scanDocument scan job', async () => {
    const dto = {
      channel: 'telegram' as const,
      externalId: 'tg:test:attach',
      senderRef: '777',
      body: 'file attached',
      attachmentPath: 'inbound/tg/attach-1.pdf',
      attachmentName: 'attach-1.pdf',
      attachmentMime: 'application/pdf',
    };
    const r = await ingestInboundMessage(prisma, dto);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledWith('scan', { kind: 'inbound_attachment', id: r.id });
  });

  it('ingest without attachment → does not enqueue a scan job', async () => {
    const dto = { channel: 'telegram' as const, externalId: 'tg:test:noattach', senderRef: '666', body: 'no file' };
    const r = await ingestInboundMessage(prisma, dto);
    expect(r.ok).toBe(true);
    expect(addMock).not.toHaveBeenCalled();
  });
});
