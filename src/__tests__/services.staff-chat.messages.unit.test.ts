import { it, expect, vi, beforeEach } from 'vitest';

const { recordAudit, createNotification, deliverNotificationToUser, addJob } = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
  deliverNotificationToUser: vi.fn(),
  addJob: vi.fn()
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications', () => ({ createNotification, deliverNotificationToUser }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: () => ({ add: addJob }) }));

import { sendStaffMessage, listStaffMessages, toggleReaction, STAFF_REACTION_EMOJI } from '@/lib/services/staffChat/messages';

const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as never;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as never;

function convFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'conv1',
    kind: 'dm',
    companyId: 'c1',
    participants: [{ userId: 'm1' }, { userId: 'm2' }],
    ...over
  };
}

function prismaFixture(over: Record<string, unknown> = {}) {
  const base = {
    staffConversation: {
      findUnique: vi.fn().mockResolvedValue(convFixture()),
      update: vi.fn().mockResolvedValue({})
    },
    staffMessage: {
      create: vi.fn().mockResolvedValue({ id: 'msg1' }),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn()
    },
    staffMessageRead: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    staffReaction: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'm2', role: 'manager' }) }
  };
  return { ...base, ...over } as never;
}

beforeEach(() => { vi.clearAllMocks(); createNotification.mockResolvedValue({ id: 'n1' }); });

it('rejects non-staff / empty / too long', async () => {
  expect(await sendStaffMessage({} as never, partner, { conversationId: 'conv1', body: 'x' })).toEqual({ ok: false, error: 'forbidden' });
  expect(await sendStaffMessage(prismaFixture(), manager, { conversationId: 'conv1', body: '   ' })).toEqual({ ok: false, error: 'empty_body' });
  expect(await sendStaffMessage(prismaFixture(), manager, { conversationId: 'conv1', body: 'а'.repeat(5001) })).toEqual({ ok: false, error: 'too_large' });
});

it('creates message, bumps lastMessageAt, audits WITHOUT body', async () => {
  const prisma = prismaFixture();
  const res = await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'привет' });
  expect(res).toEqual({ ok: true, messageId: 'msg1' });
  expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    action: 'staff_message_sent',
    entityId: 'conv1'
  }));
  const auditArg = recordAudit.mock.calls[0][1];
  expect(JSON.stringify(auditArg)).not.toContain('привет');
});

it('DM: first-unread notification once (второе сообщение подряд молчит)', async () => {
  const prisma = prismaFixture();
  await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'раз' });
  expect(createNotification).toHaveBeenCalledTimes(1);
  expect(deliverNotificationToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'm2', type: 'staff_dm_message', dedupKey: 'n1' }));
  vi.clearAllMocks();
  createNotification.mockResolvedValue({ id: 'n2' });
  const prisma2 = prismaFixture({
    staffMessage: {
      create: vi.fn().mockResolvedValue({ id: 'msg2' }),
      count: vi.fn().mockResolvedValue(3),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn()
    }
  });
  await sendStaffMessage(prisma2, manager, { conversationId: 'conv1', body: 'два' });
  expect(createNotification).not.toHaveBeenCalled();
});

it('mention notifies mentioned staff (не автора), general без per-message уведомлений', async () => {
  const prisma = prismaFixture({
    staffConversation: {
      findUnique: vi.fn().mockResolvedValue(convFixture({ kind: 'general', participants: [] })),
      update: vi.fn().mockResolvedValue({})
    },
    user: {
      findMany: vi.fn()
        .mockResolvedValueOnce([{ id: 'm2', name: 'Пётр' }, { id: 'm1', name: 'Иван' }]) // listColleagues
        .mockResolvedValueOnce([{ id: 'm2', role: 'manager' }]), // recipients load
      findUnique: vi.fn()
    }
  });
  await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'ping @Пётр и @Иван' });
  expect(deliverNotificationToUser).toHaveBeenCalledTimes(1);
  expect(deliverNotificationToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'm2', type: 'staff_chat_mention' }));
});

it('attachment: чужой префикс → forbidden; свой → scanStatus pending + enqueue kind staff_attachment', async () => {
  const prisma = prismaFixture();
  expect(await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'f', attachmentPath: 'staff-chat/OTHER/file' }))
    .toEqual({ ok: false, error: 'forbidden' });
  await sendStaffMessage(prisma, manager, {
    conversationId: 'conv1', body: 'файл',
    attachmentPath: 'staff-chat/conv1/abc-file.pdf', attachmentName: 'file.pdf', attachmentMime: 'application/pdf'
  });
  const createArg = (prisma as never as { staffMessage: { create: ReturnType<typeof vi.fn> } }).staffMessage.create.mock.calls.at(-1)![0];
  expect(createArg.data.scanStatus).toBe('pending');
  expect(addJob).toHaveBeenCalledWith('scan', { kind: 'staff_attachment', id: 'msg1' });
});

it('toggleReaction: вне набора → invalid; добавление и снятие', async () => {
  const prisma = prismaFixture({
    staffMessage: {
      findUnique: vi.fn().mockResolvedValue({ id: 'msg1', conversation: convFixture() }),
      findMany: vi.fn(), create: vi.fn(), count: vi.fn()
    }
  });
  expect(await toggleReaction(prisma, manager, { messageId: 'msg1', emoji: '🤡' })).toEqual({ ok: false, error: 'invalid' });
  expect(STAFF_REACTION_EMOJI).toContain('👍');
  const res = await toggleReaction(prisma, manager, { messageId: 'msg1', emoji: '👍' });
  expect(res).toEqual({ ok: true, reacted: true });
});

it('listStaffMessages: forbidden для не-участника dm; after-курсор игнорирует NaN', async () => {
  const prisma = prismaFixture({
    staffConversation: { findUnique: vi.fn().mockResolvedValue(convFixture({ participants: [{ userId: 'x' }, { userId: 'y' }] })), update: vi.fn() }
  });
  expect(await listStaffMessages(prisma, manager, { conversationId: 'conv1' })).toEqual({ ok: false, error: 'forbidden' });
});

// --- Дополнительные ветки для 100%-покрытия (§6) ---

it('sendStaffMessage: не-участник dm не может писать → forbidden', async () => {
  const prisma = prismaFixture({
    staffConversation: {
      findUnique: vi.fn().mockResolvedValue(convFixture({ participants: [{ userId: 'x' }, { userId: 'y' }] })),
      update: vi.fn()
    }
  });
  expect(await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'hi' })).toEqual({ ok: false, error: 'forbidden' });
});

it('sendStaffMessage: conversation_not_found', async () => {
  const prisma = prismaFixture({
    staffConversation: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() }
  });
  expect(await sendStaffMessage(prisma, manager, { conversationId: 'missing', body: 'hi' })).toEqual({ ok: false, error: 'conversation_not_found' });
});

it('sendStaffMessage: вложение без тела (body undefined) — разрешено', async () => {
  const prisma = prismaFixture();
  const args = {
    conversationId: 'conv1',
    body: undefined,
    attachmentPath: 'staff-chat/conv1/x-file.pdf',
    attachmentName: 'file.pdf',
    attachmentMime: 'application/pdf'
  } as never;
  const res = await sendStaffMessage(prisma, manager, args);
  expect(res).toEqual({ ok: true, messageId: 'msg1' });
});

it('sendStaffMessage: сбой enqueue скана логируется, отправка всё равно успешна', async () => {
  const prisma = prismaFixture();
  addJob.mockRejectedValueOnce(new Error('queue down'));
  const res = await sendStaffMessage(prisma, manager, {
    conversationId: 'conv1', body: 'файл',
    attachmentPath: 'staff-chat/conv1/x-file.pdf', attachmentName: 'file.pdf', attachmentMime: 'application/pdf'
  });
  expect(res).toEqual({ ok: true, messageId: 'msg1' });
});

it('sendStaffMessage: сбой enqueue скана не-Error значением всё равно логируется как строка', async () => {
  const prisma = prismaFixture();
  addJob.mockRejectedValueOnce('queue down (string reason)');
  const res = await sendStaffMessage(prisma, manager, {
    conversationId: 'conv1', body: 'файл',
    attachmentPath: 'staff-chat/conv1/x-file.pdf', attachmentName: 'file.pdf', attachmentMime: 'application/pdf'
  });
  expect(res).toEqual({ ok: true, messageId: 'msg1' });
});

it('sendStaffMessage: сбой создания уведомления (упоминание) перехватывается, отправка успешна', async () => {
  const prisma = prismaFixture({
    user: {
      findMany: vi.fn()
        .mockResolvedValueOnce([{ id: 'm2', name: 'Пётр' }]) // listColleagues
        .mockResolvedValueOnce([{ id: 'm2', role: 'manager' }]), // recipients load
      findUnique: vi.fn()
    }
  });
  createNotification.mockRejectedValueOnce(new Error('db down'));
  const res = await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'ping @Пётр' });
  expect(res).toEqual({ ok: true, messageId: 'msg1' });
  expect(createNotification).toHaveBeenCalledTimes(1);
});

it('sendStaffMessage: сбой уведомления не-Error значением всё равно перехватывается', async () => {
  const prisma = prismaFixture({
    user: {
      findMany: vi.fn()
        .mockResolvedValueOnce([{ id: 'm2', name: 'Пётр' }]) // listColleagues
        .mockResolvedValueOnce([{ id: 'm2', role: 'manager' }]), // recipients load
      findUnique: vi.fn()
    }
  });
  createNotification.mockRejectedValueOnce('db down (string reason)');
  const res = await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'ping @Пётр' });
  expect(res).toEqual({ ok: true, messageId: 'msg1' });
});

it('sendStaffMessage: ЛС-уведомление админу использует /admin/messages', async () => {
  const prisma = prismaFixture({
    user: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue({ id: 'm2', role: 'admin' }) }
  });
  await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'привет' });
  expect(deliverNotificationToUser).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'm2', type: 'staff_dm_message', url: '/admin/messages' })
  );
});

it('DM: получатель упомянут И «первое непрочитанное» → ровно ОДНО уведомление (mention, без staff_dm_message)', async () => {
  const prisma = prismaFixture({
    user: {
      findMany: vi.fn()
        .mockResolvedValueOnce([{ id: 'm2', name: 'Пётр' }]) // listColleagues
        .mockResolvedValueOnce([{ id: 'm2', role: 'manager' }]), // mention recipients
      findUnique: vi.fn()
    }
  });
  await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'привет @Пётр' });
  expect(deliverNotificationToUser).toHaveBeenCalledTimes(1);
  expect(deliverNotificationToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'm2', type: 'staff_chat_mention' }));
});

it('sendStaffMessage: first-unread считается верно при наличии предыдущей отметки прочтения', async () => {
  const prisma = prismaFixture({
    staffMessageRead: {
      findUnique: vi.fn().mockResolvedValue({ lastReadAt: new Date('2026-07-01T00:00:00Z') }),
      upsert: vi.fn().mockResolvedValue({})
    }
  });
  await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'привет' });
  expect(createNotification).toHaveBeenCalledTimes(1);
});

it('sendStaffMessage: поднимает read-state автора (своя отправка не зажигает автору его же unread)', async () => {
  const prisma = prismaFixture();
  await sendStaffMessage(prisma, manager, { conversationId: 'conv1', body: 'привет' });
  const upsert = (prisma as never as { staffMessageRead: { upsert: ReturnType<typeof vi.fn> } }).staffMessageRead.upsert;
  expect(upsert).toHaveBeenCalledWith({
    where: { conversationId_userId: { conversationId: 'conv1', userId: 'm1' } },
    update: { lastReadAt: expect.any(Date) },
    create: { conversationId: 'conv1', userId: 'm1' }
  });
});

it('listStaffMessages: не-staff вызывающий → forbidden без обращения к prisma', async () => {
  expect(await listStaffMessages({} as never, partner, { conversationId: 'conv1' })).toEqual({ ok: false, error: 'forbidden' });
});

it('listStaffMessages: conversation_not_found', async () => {
  const prisma = prismaFixture({
    staffConversation: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() }
  });
  expect(await listStaffMessages(prisma, manager, { conversationId: 'missing' })).toEqual({ ok: false, error: 'conversation_not_found' });
});

it('listStaffMessages: happy path — агрегация реакций (incl. mine) + валидный after-курсор', async () => {
  const createdAt = new Date('2026-07-17T10:00:00Z');
  const prisma = prismaFixture({
    staffMessage: {
      create: vi.fn(), count: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'msgA', authorId: 'm2', body: 'привет', attachmentPath: null, attachmentName: null,
          scanStatus: 'none', createdAt,
          author: { name: 'Пётр' },
          reactions: [
            { userId: 'm1', emoji: '👍' },
            { userId: 'm3', emoji: '👍' },
            { userId: 'm2', emoji: '🔥' }
          ]
        }
      ]),
      findUnique: vi.fn()
    }
  });
  const res = await listStaffMessages(prisma, manager, { conversationId: 'conv1', after: '2026-07-17T09:00:00Z' });
  expect(res).toEqual({
    ok: true,
    rows: [{
      id: 'msgA', authorId: 'm2', authorName: 'Пётр', body: 'привет',
      hasAttachment: false, attachmentName: null, scanStatus: 'none', createdAt,
      reactions: [
        { emoji: '👍', count: 2, mine: true },
        { emoji: '🔥', count: 1, mine: false }
      ]
    }]
  });
  const findManyCall = (prisma as never as { staffMessage: { findMany: ReturnType<typeof vi.fn> } }).staffMessage.findMany.mock.calls[0][0];
  expect(findManyCall.where.createdAt).toEqual({ gt: new Date('2026-07-17T09:00:00Z') });
});

it('listStaffMessages: невалидный after (NaN) игнорируется — фильтр по createdAt не применяется', async () => {
  const prisma = prismaFixture({
    staffMessage: { create: vi.fn(), count: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() }
  });
  await listStaffMessages(prisma, manager, { conversationId: 'conv1', after: 'not-a-date' });
  const findManyCall = (prisma as never as { staffMessage: { findMany: ReturnType<typeof vi.fn> } }).staffMessage.findMany.mock.calls[0][0];
  expect(findManyCall.where).toEqual({ conversationId: 'conv1' });
});

it('listStaffMessages: без after вообще — фильтр по createdAt не применяется', async () => {
  const prisma = prismaFixture({
    staffMessage: { create: vi.fn(), count: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() }
  });
  await listStaffMessages(prisma, manager, { conversationId: 'conv1' });
  const findManyCall = (prisma as never as { staffMessage: { findMany: ReturnType<typeof vi.fn> } }).staffMessage.findMany.mock.calls[0][0];
  expect(findManyCall.where).toEqual({ conversationId: 'conv1' });
});

it('listStaffMessages: автор без имени (name: null) отдаётся пустой строкой', async () => {
  const createdAt = new Date('2026-07-17T10:00:00Z');
  const prisma = prismaFixture({
    staffMessage: {
      create: vi.fn(), count: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'msgB', authorId: 'm2', body: 'привет', attachmentPath: null, attachmentName: null,
          scanStatus: 'none', createdAt, author: { name: null }, reactions: []
        }
      ]),
      findUnique: vi.fn()
    }
  });
  const res = await listStaffMessages(prisma, manager, { conversationId: 'conv1' });
  expect(res).toEqual({
    ok: true,
    rows: [{
      id: 'msgB', authorId: 'm2', authorName: '', body: 'привет',
      hasAttachment: false, attachmentName: null, scanStatus: 'none', createdAt, reactions: []
    }]
  });
});

it('toggleReaction: не-staff вызывающий → forbidden', async () => {
  expect(await toggleReaction({} as never, partner, { messageId: 'msg1', emoji: '👍' })).toEqual({ ok: false, error: 'forbidden' });
});

it('toggleReaction: message_not_found', async () => {
  const prisma = prismaFixture({
    staffMessage: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn(), create: vi.fn(), count: vi.fn() }
  });
  expect(await toggleReaction(prisma, manager, { messageId: 'missing', emoji: '👍' })).toEqual({ ok: false, error: 'message_not_found' });
});

it('toggleReaction: не-участник беседы сообщения → forbidden', async () => {
  const prisma = prismaFixture({
    staffMessage: {
      findUnique: vi.fn().mockResolvedValue({ id: 'msg1', conversation: convFixture({ participants: [{ userId: 'x' }, { userId: 'y' }] }) }),
      findMany: vi.fn(), create: vi.fn(), count: vi.fn()
    }
  });
  expect(await toggleReaction(prisma, manager, { messageId: 'msg1', emoji: '👍' })).toEqual({ ok: false, error: 'forbidden' });
});

it('toggleReaction: повторный тоггл снимает существующую реакцию', async () => {
  const prisma = prismaFixture({
    staffMessage: {
      findUnique: vi.fn().mockResolvedValue({ id: 'msg1', conversation: convFixture() }),
      findMany: vi.fn(), create: vi.fn(), count: vi.fn()
    },
    staffReaction: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn().mockResolvedValue({ id: 'r1' }) }
  });
  const res = await toggleReaction(prisma, manager, { messageId: 'msg1', emoji: '👍' });
  expect(res).toEqual({ ok: true, reacted: false });
  expect((prisma as never as { staffReaction: { delete: ReturnType<typeof vi.fn> } }).staffReaction.delete)
    .toHaveBeenCalledWith({ where: { id: 'r1' } });
});

it('toggleReaction: P2002 на create (конкурентный идентичный toggle) → ok, reacted: true', async () => {
  const prisma = prismaFixture({
    staffMessage: {
      findUnique: vi.fn().mockResolvedValue({ id: 'msg1', conversation: convFixture() }),
      findMany: vi.fn(), create: vi.fn(), count: vi.fn()
    },
    staffReaction: {
      create: vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' })),
      delete: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null)
    }
  });
  expect(await toggleReaction(prisma, manager, { messageId: 'msg1', emoji: '👍' })).toEqual({ ok: true, reacted: true });
});

it('toggleReaction: не-P2002 ошибка create пробрасывается', async () => {
  const prisma = prismaFixture({
    staffMessage: {
      findUnique: vi.fn().mockResolvedValue({ id: 'msg1', conversation: convFixture() }),
      findMany: vi.fn(), create: vi.fn(), count: vi.fn()
    },
    staffReaction: {
      create: vi.fn().mockRejectedValue(new Error('db down')),
      delete: vi.fn(),
      findUnique: vi.fn().mockResolvedValue(null)
    }
  });
  await expect(toggleReaction(prisma, manager, { messageId: 'msg1', emoji: '👍' })).rejects.toThrow('db down');
});
