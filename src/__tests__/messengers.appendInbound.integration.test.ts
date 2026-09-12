import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Р-М-9: уведомление менеджерам — свой сервис со своими тестами; здесь
// проверяется только, когда и с чем его зовут, и что его сбой не роняет реплику.
const { notifyManagersMessengerMessage } = vi.hoisted(() => ({
  notifyManagersMessengerMessage: vi.fn(),
}));
vi.mock('@/lib/notifications/manager', () => ({ notifyManagersMessengerMessage }));

import { appendInboundToDialog } from '@/lib/services/messengers/appendInbound';

/**
 * Входящее из мессенджера → реплика диалога (спека 2026-09-12, Р-М-1/Р-М-2)
 * на живой базе: уникальность собеседника, идемпотентность по письму,
 * привязка «только ничьему», переоткрытие, счётчик непрочитанных,
 * уведомление менеджерам организации диалога (Р-М-9).
 */
const prisma = new PrismaClient();
const STAMP = `msgrai${Date.now()}`;
const EXT = `msgr:test:${STAMP}:`;

let companyId = '';
let orgId = '';
let otherCompanyId = '';
let seq = 0;

/** Письмо «Входящих» — у реплики есть внешний ключ на него. */
async function inbound(peerRef: string, body: string) {
  seq += 1;
  return prisma.inboundMessage.create({
    data: {
      channel: 'telegram',
      externalId: `${EXT}${seq}`,
      senderRef: peerRef,
      body,
    },
    select: { id: true, externalId: true },
  });
}

function peer(name: string): string {
  return `${STAMP}-${name}`;
}

beforeAll(async () => {
  const co = await prisma.company.create({ data: { name: `${STAMP}-co` } });
  companyId = co.id;
  const org = await prisma.organization.create({
    data: { name: `${STAMP}-org`, companyId },
  });
  orgId = org.id;
  const other = await prisma.company.create({ data: { name: `${STAMP}-co2` } });
  otherCompanyId = other.id;
});

beforeEach(() => {
  notifyManagersMessengerMessage.mockReset();
  notifyManagersMessengerMessage.mockResolvedValue({
    recipientsNotified: 0,
    emailsSent: 0,
    emailsSkipped: 0,
  });
});

afterAll(async () => {
  await prisma.messengerDialog.deleteMany({ where: { peerRef: { startsWith: STAMP } } });
  await prisma.inboundMessage.deleteMany({ where: { externalId: { startsWith: EXT } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: STAMP } } });
  await prisma.$disconnect();
});

describe('appendInboundToDialog (integration)', () => {
  it('новый собеседник → открытый диалог с одним непрочитанным и реплика «in»; ничей — без уведомления', async () => {
    const im = await inbound(peer('a'), 'Здравствуйте, нужен счёт');
    const r = await appendInboundToDialog(prisma, {
      inboundMessageId: im.id,
      channel: 'telegram',
      peerRef: peer('a'),
      peerDisplay: 'Иван',
      body: 'Здравствуйте, нужен счёт',
      externalId: im.externalId,
      binding: null,
    });
    expect(r.deduped).toBe(false);

    const dialog = await prisma.messengerDialog.findUnique({
      where: { id: r.dialogId },
      include: { messages: true },
    });
    expect(dialog).toMatchObject({
      channel: 'telegram',
      peerRef: peer('a'),
      peerDisplay: 'Иван',
      companyId: null,
      status: 'open',
      unreadCount: 1,
      lastMessagePreview: 'Здравствуйте, нужен счёт',
      lastMessageDirection: 'in',
    });
    expect(dialog?.lastInboundAt).not.toBeNull();
    expect(dialog?.messages).toHaveLength(1);
    expect(dialog?.messages[0]).toMatchObject({
      id: r.messageId,
      direction: 'in',
      inboundMessageId: im.id,
      externalId: im.externalId,
      body: 'Здравствуйте, нужен счёт',
    });
    expect(notifyManagersMessengerMessage).not.toHaveBeenCalled();
  });

  it('повтор того же письма → deduped, второй реплики нет, счётчик не растёт', async () => {
    const im = await inbound(peer('b'), 'раз');
    const args = {
      inboundMessageId: im.id,
      channel: 'telegram' as const,
      peerRef: peer('b'),
      body: 'раз',
      externalId: im.externalId,
      binding: null,
    };
    const first = await appendInboundToDialog(prisma, args);
    const second = await appendInboundToDialog(prisma, args);
    expect(second).toEqual({ ...first, deduped: true });
    const dialog = await prisma.messengerDialog.findUnique({
      where: { id: first.dialogId },
      include: { messages: true },
    });
    expect(dialog?.messages).toHaveLength(1);
    expect(dialog?.unreadCount).toBe(1);
  });

  it('второе письмо того же собеседника → тот же диалог, счётчик 2, превью и время — от последнего', async () => {
    const im1 = await inbound(peer('c'), 'первое');
    const im2 = await inbound(peer('c'), 'второе  сообщение');
    const t1 = new Date('2026-09-01T10:00:00Z');
    const t2 = new Date('2026-09-02T10:00:00Z');
    const r1 = await appendInboundToDialog(prisma, {
      inboundMessageId: im1.id,
      channel: 'telegram',
      peerRef: peer('c'),
      body: 'первое',
      externalId: im1.externalId,
      sentAt: t1,
      binding: null,
    });
    const r2 = await appendInboundToDialog(prisma, {
      inboundMessageId: im2.id,
      channel: 'telegram',
      peerRef: peer('c'),
      body: 'второе  сообщение',
      externalId: im2.externalId,
      sentAt: t2,
      binding: null,
    });
    expect(r2.dialogId).toBe(r1.dialogId);
    const dialog = await prisma.messengerDialog.findUnique({
      where: { id: r1.dialogId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    expect(dialog?.unreadCount).toBe(2);
    expect(dialog?.lastMessagePreview).toBe('второе сообщение');
    expect(dialog?.lastMessageAt.toISOString()).toBe(t2.toISOString());
    expect(dialog?.lastInboundAt?.toISOString()).toBe(t2.toISOString());
    expect(dialog?.messages.map((m) => m.createdAt.toISOString())).toEqual([
      t1.toISOString(),
      t2.toISOString(),
    ]);
  });

  it('распознанный отправитель привязывает ничей диалог и зовёт уведомление; уже привязанный не перепривязывается', async () => {
    const im1 = await inbound(peer('d'), 'кто я?');
    const r1 = await appendInboundToDialog(prisma, {
      inboundMessageId: im1.id,
      channel: 'telegram',
      peerRef: peer('d'),
      body: 'кто я?',
      externalId: im1.externalId,
      binding: null,
    });
    expect(
      (await prisma.messengerDialog.findUnique({ where: { id: r1.dialogId } }))?.companyId
    ).toBeNull();

    const im2 = await inbound(peer('d'), 'теперь узнали');
    await appendInboundToDialog(prisma, {
      inboundMessageId: im2.id,
      channel: 'telegram',
      peerRef: peer('d'),
      peerDisplay: 'Дмитрий',
      body: 'теперь узнали',
      externalId: im2.externalId,
      binding: { companyId, organizationId: orgId, contactId: null, userId: null },
    });
    const bound = await prisma.messengerDialog.findUnique({ where: { id: r1.dialogId } });
    expect(bound).toMatchObject({ companyId, organizationId: orgId });
    // Привязка состоялась в этом же вызове — организация уже известна.
    expect(notifyManagersMessengerMessage).toHaveBeenCalledWith(expect.anything(), {
      organizationId: orgId,
      dialogId: r1.dialogId,
      peerLabel: 'Дмитрий',
      channelLabel: 'Telegram',
      excerpt: 'теперь узнали',
    });

    // Резолвер узнал собеседника «в другой компании» — сотрудник уже решил, чей
    // это диалог, автоматика его решение не отменяет; уведомление — прежней
    // организации.
    notifyManagersMessengerMessage.mockClear();
    const im3 = await inbound(peer('d'), 'а вдруг чужой');
    await appendInboundToDialog(prisma, {
      inboundMessageId: im3.id,
      channel: 'telegram',
      peerRef: peer('d'),
      body: 'а вдруг чужой',
      externalId: im3.externalId,
      binding: { companyId: otherCompanyId, organizationId: null, contactId: null, userId: null },
    });
    const still = await prisma.messengerDialog.findUnique({ where: { id: r1.dialogId } });
    expect(still).toMatchObject({ companyId, organizationId: orgId });
    expect(notifyManagersMessengerMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: orgId, peerLabel: 'Дмитрий' })
    );
  });

  it('новое письмо с привязкой сразу создаёт диалог компании; без имени собеседник подписан адресом', async () => {
    const im = await inbound(peer('e'), 'известный клиент');
    const r = await appendInboundToDialog(prisma, {
      inboundMessageId: im.id,
      channel: 'telegram',
      peerRef: peer('e'),
      body: 'известный клиент',
      externalId: im.externalId,
      binding: { companyId, organizationId: orgId, contactId: null, userId: null },
    });
    expect(await prisma.messengerDialog.findUnique({ where: { id: r.dialogId } })).toMatchObject({
      companyId,
      organizationId: orgId,
    });
    expect(notifyManagersMessengerMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: orgId, peerLabel: peer('e') })
    );
  });

  it('привязка к компании без организации — уведомлять некого', async () => {
    const im = await inbound(peer('h'), 'компания без организации');
    await appendInboundToDialog(prisma, {
      inboundMessageId: im.id,
      channel: 'telegram',
      peerRef: peer('h'),
      body: 'компания без организации',
      externalId: im.externalId,
      binding: { companyId, organizationId: null, contactId: null, userId: null },
    });
    expect(notifyManagersMessengerMessage).not.toHaveBeenCalled();
  });

  it('сбой уведомления не роняет реплику (best-effort)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    notifyManagersMessengerMessage.mockRejectedValueOnce(new Error('smtp down'));
    const im = await inbound(peer('i'), 'письмо при сбое почты');
    const r = await appendInboundToDialog(prisma, {
      inboundMessageId: im.id,
      channel: 'telegram',
      peerRef: peer('i'),
      body: 'письмо при сбое почты',
      externalId: im.externalId,
      binding: { companyId, organizationId: orgId, contactId: null, userId: null },
    });
    expect(r.deduped).toBe(false);
    expect(await prisma.messengerMessage.count({ where: { inboundMessageId: im.id } })).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      '[messengers/appendInbound] notify managers failed',
      expect.any(Error)
    );
    warn.mockRestore();
  });

  it('закрытый диалог переоткрывается новым входящим', async () => {
    const im1 = await inbound(peer('f'), 'до закрытия');
    const r1 = await appendInboundToDialog(prisma, {
      inboundMessageId: im1.id,
      channel: 'telegram',
      peerRef: peer('f'),
      body: 'до закрытия',
      externalId: im1.externalId,
      binding: null,
    });
    await prisma.messengerDialog.update({
      where: { id: r1.dialogId },
      data: { status: 'closed', unreadCount: 0 },
    });
    const im2 = await inbound(peer('f'), 'ещё вопрос');
    await appendInboundToDialog(prisma, {
      inboundMessageId: im2.id,
      channel: 'telegram',
      peerRef: peer('f'),
      body: 'ещё вопрос',
      externalId: im2.externalId,
      binding: null,
    });
    expect(await prisma.messengerDialog.findUnique({ where: { id: r1.dialogId } })).toMatchObject({
      status: 'open',
      unreadCount: 1,
    });
  });

  it('markUnread:false не растит счётчик и не шлёт уведомление; пустое имя не стирает известное', async () => {
    const im1 = await inbound(peer('g'), 'с именем');
    const r1 = await appendInboundToDialog(prisma, {
      inboundMessageId: im1.id,
      channel: 'telegram',
      peerRef: peer('g'),
      peerDisplay: 'Пётр',
      body: 'с именем',
      externalId: im1.externalId,
      binding: { companyId, organizationId: orgId, contactId: null, userId: null },
      markUnread: false,
    });
    const im2 = await inbound(peer('g'), 'без имени');
    await appendInboundToDialog(prisma, {
      inboundMessageId: im2.id,
      channel: 'telegram',
      peerRef: peer('g'),
      peerDisplay: null,
      body: 'без имени',
      externalId: im2.externalId,
      binding: null,
      markUnread: false,
    });
    expect(await prisma.messengerDialog.findUnique({ where: { id: r1.dialogId } })).toMatchObject({
      unreadCount: 0,
      peerDisplay: 'Пётр',
    });
    expect(notifyManagersMessengerMessage).not.toHaveBeenCalled();

    // Новое имя от провайдера — обновляется; живое письмо — уведомление.
    const im3 = await inbound(peer('g'), 'сменил ник');
    await appendInboundToDialog(prisma, {
      inboundMessageId: im3.id,
      channel: 'telegram',
      peerRef: peer('g'),
      peerDisplay: 'Пётр П.',
      body: 'сменил ник',
      externalId: im3.externalId,
      binding: null,
    });
    expect(await prisma.messengerDialog.findUnique({ where: { id: r1.dialogId } })).toMatchObject({
      unreadCount: 1,
      peerDisplay: 'Пётр П.',
    });
    expect(notifyManagersMessengerMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: orgId,
        peerLabel: 'Пётр П.',
        excerpt: 'сменил ник',
      })
    );
  });
});
