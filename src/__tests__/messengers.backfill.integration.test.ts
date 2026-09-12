import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  backfillDialogsFromInbound,
  countPendingBackfill,
} from '@/lib/services/messengers/backfill';

/**
 * Бэкфилл диалогов из «Входящих» (спека 2026-09-12, Р-М-10) на живой базе:
 * пачки с курсором, привязка из письма, старые письма не считаются
 * непрочитанными, повторный запуск ничего не двоит, почта не трогается.
 */
const prisma = new PrismaClient();
const STAMP = `msgrbf${Date.now()}`;
const EXT = `msgrbf:test:${STAMP}:`;

let companyId = '';
let orgId = '';

beforeAll(async () => {
  const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
  companyId = co.id;
  const org = await prisma.organization.create({ data: { name: `${STAMP}-org`, companyId } });
  orgId = org.id;
});

afterAll(async () => {
  await prisma.messengerDialog.deleteMany({ where: { peerRef: { startsWith: STAMP } } });
  await prisma.inboundMessage.deleteMany({ where: { externalId: { startsWith: EXT } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.$disconnect();
});

describe('backfillDialogsFromInbound (integration)', () => {
  it('сворачивает письма мессенджеров в диалоги пачками, почту не трогает, повтор — пусто', async () => {
    const before = await countPendingBackfill(prisma);
    const base = Date.parse('2026-08-01T00:00:00Z');
    // Три письма одного собеседника (два непривязанных и одно привязанное) +
    // одно чужого + письмо почты, которое в диалог не попадает.
    const rows = await Promise.all([
      prisma.inboundMessage.create({
        data: {
          channel: 'telegram',
          externalId: `${EXT}1`,
          senderRef: `${STAMP}-p1`,
          body: 'первое',
          createdAt: new Date(base + 1000),
        },
      }),
      prisma.inboundMessage.create({
        data: {
          channel: 'telegram',
          externalId: `${EXT}2`,
          senderRef: `${STAMP}-p1`,
          body: 'второе',
          createdAt: new Date(base + 2000),
          sentAt: new Date(base + 1500),
        },
      }),
      prisma.inboundMessage.create({
        data: {
          channel: 'telegram',
          externalId: `${EXT}3`,
          senderRef: `${STAMP}-p1`,
          body: 'третье, уже привязанное',
          createdAt: new Date(base + 3000),
          status: 'bound',
          companyId,
          resolvedOrgId: orgId,
        },
      }),
      prisma.inboundMessage.create({
        data: {
          channel: 'whatsapp',
          externalId: `${EXT}4`,
          senderRef: `${STAMP}-p2`,
          body: 'другой собеседник',
          createdAt: new Date(base + 4000),
        },
      }),
      prisma.inboundMessage.create({
        data: {
          channel: 'email',
          externalId: `${EXT}5`,
          senderRef: `${STAMP}@example.test`,
          body: 'письмо',
          createdAt: new Date(base + 5000),
        },
      }),
    ]);
    expect((await countPendingBackfill(prisma)) - before).toBe(4);

    // Пачка меньше числа писем — проверяются и курсор, и последняя неполная пачка.
    const report = await backfillDialogsFromInbound(prisma, { batchSize: 2 });
    expect(report.scanned).toBeGreaterThanOrEqual(4);
    expect(report.appended).toBeGreaterThanOrEqual(4);
    expect(await countPendingBackfill(prisma)).toBe(0);

    const p1 = await prisma.messengerDialog.findUnique({
      where: { channel_peerRef: { channel: 'telegram', peerRef: `${STAMP}-p1` } },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    expect(p1).toMatchObject({
      companyId,
      organizationId: orgId,
      unreadCount: 0,
      lastMessagePreview: 'третье, уже привязанное',
    });
    expect(p1?.messages.map((m) => m.inboundMessageId)).toEqual([
      rows[0].id,
      rows[1].id,
      rows[2].id,
    ]);
    // Время реплики — время сообщения у провайдера, а при его отсутствии — приёма.
    expect(p1?.messages[1]?.createdAt.toISOString()).toBe(new Date(base + 1500).toISOString());
    expect(p1?.messages[0]?.createdAt.toISOString()).toBe(new Date(base + 1000).toISOString());

    const p2 = await prisma.messengerDialog.findUnique({
      where: { channel_peerRef: { channel: 'whatsapp', peerRef: `${STAMP}-p2` } },
    });
    expect(p2).toMatchObject({ companyId: null, unreadCount: 0 });

    const mail = await prisma.inboundMessage.findUnique({
      where: { id: rows[4].id },
      include: { dialogMessage: true },
    });
    expect(mail?.dialogMessage).toBeNull();

    // Повтор: складывать нечего.
    expect(await backfillDialogsFromInbound(prisma, { batchSize: 2 })).toEqual({
      scanned: 0,
      appended: 0,
    });
  });

  it('уже сложенное письмо (реплика есть) в выборку не попадает; размер пачки ≥ 1', async () => {
    const im = await prisma.inboundMessage.create({
      data: {
        channel: 'max',
        externalId: `${EXT}6`,
        senderRef: `${STAMP}-p3`,
        body: 'уже в диалоге',
        dialogMessage: {
          create: {
            direction: 'in',
            body: 'уже в диалоге',
            dialog: { create: { channel: 'max', peerRef: `${STAMP}-p3` } },
          },
        },
      },
    });
    const report = await backfillDialogsFromInbound(prisma, { batchSize: 0 });
    expect(report).toEqual({ scanned: 0, appended: 0 });
    const messages = await prisma.messengerMessage.count({ where: { inboundMessageId: im.id } });
    expect(messages).toBe(1);
  });
});
