import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { recordOutboundInDialog } from '@/lib/services/messengers/recordOutbound';

/**
 * Исходящее → история диалога (спека 2026-09-12, Р-М-7) на живой базе: диалог
 * заводится при необходимости, привязка существующего не меняется, ответ
 * сотрудника обнуляет непрочитанное, неудачная отправка остаётся в истории.
 */
const prisma = new PrismaClient();
const STAMP = `msgrro${Date.now()}`;

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
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.$disconnect();
});

describe('recordOutboundInDialog (integration)', () => {
  it('диалога нет → создаётся с переданной привязкой и репликой «out»', async () => {
    const r = await recordOutboundInDialog(prisma, {
      channel: 'whatsapp',
      peerRef: `${STAMP}-a`,
      authorId: 'mgr-1',
      text: 'Добрый день!  Счёт отправил.',
      delivered: true,
      binding: { companyId, organizationId: orgId, contactId: null, userId: null },
    });
    const dialog = await prisma.messengerDialog.findUnique({
      where: { id: r.dialogId },
      include: { messages: true },
    });
    expect(dialog).toMatchObject({
      channel: 'whatsapp',
      companyId,
      organizationId: orgId,
      status: 'open',
      unreadCount: 0,
      lastMessagePreview: 'Добрый день! Счёт отправил.',
      lastMessageDirection: 'out',
      lastInboundAt: null,
    });
    expect(dialog?.messages).toEqual([
      expect.objectContaining({
        id: r.messageId,
        direction: 'out',
        authorId: 'mgr-1',
        deliveryStatus: 'sent',
        inboundMessageId: null,
      }),
    ]);
  });

  it('существующий диалог: непрочитанное обнуляется, закрытый открывается, привязка не меняется', async () => {
    const existing = await prisma.messengerDialog.create({
      data: {
        channel: 'max',
        peerRef: `${STAMP}-b`,
        companyId,
        status: 'closed',
        unreadCount: 3,
        lastMessagePreview: 'клиент писал',
        lastMessageDirection: 'in',
      },
    });
    const r = await recordOutboundInDialog(prisma, {
      channel: 'max',
      peerRef: `${STAMP}-b`,
      authorId: 'mgr-1',
      text: 'отвечаю',
      delivered: true,
    });
    expect(r.dialogId).toBe(existing.id);
    expect(await prisma.messengerDialog.findUnique({ where: { id: existing.id } })).toMatchObject({
      companyId,
      status: 'open',
      unreadCount: 0,
      lastMessagePreview: 'отвечаю',
      lastMessageDirection: 'out',
    });
  });

  it('неудачная отправка остаётся в истории как failed; пустая привязка → ничей диалог', async () => {
    const r = await recordOutboundInDialog(prisma, {
      channel: 'telegram',
      peerRef: `${STAMP}-c`,
      authorId: 'mgr-2',
      text: 'не дошло',
      delivered: false,
      binding: { companyId: null, organizationId: null, contactId: null, userId: null },
    });
    const message = await prisma.messengerMessage.findUnique({ where: { id: r.messageId } });
    expect(message?.deliveryStatus).toBe('failed');
    expect(await prisma.messengerDialog.findUnique({ where: { id: r.dialogId } })).toMatchObject({
      companyId: null,
      organizationId: null,
    });
  });
});
