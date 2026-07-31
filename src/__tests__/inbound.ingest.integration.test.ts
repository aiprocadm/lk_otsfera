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
    const dto = {
      channel: 'telegram' as const,
      externalId: 'tg:test:1',
      senderRef: '999',
      body: 'привет',
    };
    const r1 = await ingestInboundMessage(prisma, dto);
    expect(r1.ok).toBe(true);
    const r2 = await ingestInboundMessage(prisma, dto);
    expect(r2.ok).toBe(true);
    const rows = await prisma.inboundMessage.findMany({ where: { externalId: 'tg:test:1' } });
    expect(rows).toHaveLength(1);
  });

  it('unresolved sender → status unresolved, companyId null', async () => {
    const r = await ingestInboundMessage(prisma, {
      channel: 'telegram',
      externalId: 'tg:test:2',
      senderRef: 'unknown',
      body: 'x',
    });
    expect(r.ok).toBe(true);
    const row = await prisma.inboundMessage.findUnique({ where: { externalId: 'tg:test:2' } });
    expect(row?.status).toBe('unresolved');
    expect(row?.companyId).toBeNull();
  });

  it('exact match → status bound + companyId bound from resolver (scope binding)', async () => {
    const stamp = Date.now();
    const company = await prisma.company.create({ data: { name: `inb-co-${stamp}` } });
    const org = await prisma.organization.create({
      data: { name: `inb-org-${stamp}`, companyId: company.id },
    });
    const user = await prisma.user.create({
      data: {
        email: `inb-${stamp}@t.local`,
        name: 'U',
        role: 'organization',
        organizationId: org.id,
        telegramChatId: `tgc-${stamp}`,
      },
    });
    try {
      const r = await ingestInboundMessage(prisma, {
        channel: 'telegram',
        externalId: `tg:test:bound:${stamp}`,
        senderRef: `tgc-${stamp}`,
        body: 'hi',
      });
      expect(r.ok).toBe(true);
      const row = await prisma.inboundMessage.findUnique({
        where: { externalId: `tg:test:bound:${stamp}` },
      });
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

  it('contact channel match (M2) → status bound + contactId persisted, no User row needed', async () => {
    const stamp = Date.now();
    const company = await prisma.company.create({ data: { name: `inb-kco-${stamp}` } });
    const org = await prisma.organization.create({
      data: { name: `inb-korg-${stamp}`, companyId: company.id },
    });
    const contact = await prisma.contact.create({
      data: {
        companyId: company.id,
        organizationId: org.id,
        name: `inb-contact-${stamp}`,
        channels: {
          create: [
            {
              companyId: company.id,
              type: 'telegram',
              value: `tgc-k-${stamp}`,
              normalizedValue: `tgc-k-${stamp}`,
            },
          ],
        },
      },
    });
    try {
      const r = await ingestInboundMessage(prisma, {
        channel: 'telegram',
        externalId: `tg:test:contact:${stamp}`,
        senderRef: `tgc-k-${stamp}`,
        body: 'hi from contact',
      });
      expect(r.ok).toBe(true);
      const row = await prisma.inboundMessage.findUnique({
        where: { externalId: `tg:test:contact:${stamp}` },
      });
      expect(row?.status).toBe('bound');
      expect(row?.contactId).toBe(contact.id);
      expect(row?.resolvedOrgId).toBe(org.id);
      expect(row?.companyId).toBe(company.id);
    } finally {
      await prisma.inboundMessage.deleteMany({ where: { externalId: `tg:test:contact:${stamp}` } });
      await prisma.contactChannel.deleteMany({ where: { contactId: contact.id } });
      await prisma.contact.delete({ where: { id: contact.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.company.delete({ where: { id: company.id } });
    }
  });

  it('concurrent duplicate delivery → single row (race handled, no throw)', async () => {
    const dto = {
      channel: 'telegram' as const,
      externalId: 'tg:test:race',
      senderRef: '888',
      body: 'race',
    };
    const [a, b] = await Promise.all([
      ingestInboundMessage(prisma, dto),
      ingestInboundMessage(prisma, dto),
    ]);
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
    const dto = {
      channel: 'telegram' as const,
      externalId: 'tg:test:noattach',
      senderRef: '666',
      body: 'no file',
    };
    const r = await ingestInboundMessage(prisma, dto);
    expect(r.ok).toBe(true);
    expect(addMock).not.toHaveBeenCalled();
  });

  it('enqueue failure is swallowed (CLAUDE.md §3): ingest stays ok, scanStatus pending', async () => {
    addMock.mockRejectedValue(new Error('redis down'));
    const dto = {
      channel: 'telegram' as const,
      externalId: 'tg:test:attach-enq-fail',
      senderRef: '555',
      body: 'file attached',
      attachmentPath: 'inbound/tg/fail-1.pdf',
    };
    const r = await ingestInboundMessage(prisma, dto);
    expect(r.ok).toBe(true);
    const row = await prisma.inboundMessage.findUnique({
      where: { externalId: 'tg:test:attach-enq-fail' },
    });
    expect(row?.scanStatus).toBe('pending'); // backfill-sweep подберёт позже
    await prisma.inboundMessage.deleteMany({ where: { externalId: 'tg:test:attach-enq-fail' } });
  });

  it('max/whatsapp каналы прокидывают senderRef в свой резолв-параметр', async () => {
    const rMax = await ingestInboundMessage(prisma, {
      channel: 'max',
      externalId: 'tg:test:max-ch',
      senderRef: 'max-1',
      body: 'x',
    });
    expect(rMax.ok).toBe(true);
    const rWa = await ingestInboundMessage(prisma, {
      channel: 'whatsapp',
      externalId: 'tg:test:wa-ch',
      senderRef: '+79990007777',
      body: 'x',
    });
    expect(rWa.ok).toBe(true);
    const rEmail = await ingestInboundMessage(prisma, {
      channel: 'email',
      externalId: 'tg:test:email-ch',
      senderRef: 'nobody@nowhere.test',
      body: 'x',
    });
    expect(rEmail.ok).toBe(true);
    const rows = await prisma.inboundMessage.findMany({
      where: { externalId: { in: ['tg:test:max-ch', 'tg:test:wa-ch', 'tg:test:email-ch'] } },
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'unresolved')).toBe(true);
  });

  it('P2002-гонка, где racer-строка не находится повторно → id "" (защитный ??)', async () => {
    const { Prisma } = await import('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    } as never);
    const poisoned = {
      inboundMessage: {
        findUnique: vi.fn().mockResolvedValue(null), // и предчек, и пост-гоночный поиск
        create: vi.fn().mockRejectedValue(p2002),
      },
      contactChannel: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      syncLog: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const r = await ingestInboundMessage(poisoned, {
      channel: 'telegram',
      externalId: 'tg:test:ghost-race',
      senderRef: '333',
      body: 'x',
    });
    expect(r).toEqual({ ok: true, id: '', deduped: true });
  });

  it('enqueue-падение НЕ-Error значением стрингифицируется в warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    addMock.mockRejectedValue('queue unavailable');
    const r = await ingestInboundMessage(prisma, {
      channel: 'telegram',
      externalId: 'tg:test:attach-enq-str',
      senderRef: '222',
      body: 'file',
      attachmentPath: 'inbound/tg/fail-2.pdf',
    });
    expect(r.ok).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[inbound/ingest] enqueue scan failed',
      expect.objectContaining({ error: 'queue unavailable' })
    );
    warn.mockRestore();
    await prisma.inboundMessage.deleteMany({ where: { externalId: 'tg:test:attach-enq-str' } });
  });

  it('non-P2002 create failure rethrows (не маскируется под дедуп)', async () => {
    const poisoned = {
      inboundMessage: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(new Error('db exploded')),
      },
      contactChannel: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await expect(
      ingestInboundMessage(poisoned, {
        channel: 'telegram',
        externalId: 'tg:test:boom',
        senderRef: '444',
        body: 'x',
      })
    ).rejects.toThrow('db exploded');
  });
});
