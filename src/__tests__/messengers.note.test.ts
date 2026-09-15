import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const m = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  notifyNoteMention: vi.fn(),
  listColleagues: vi.fn(),
  extractMentions: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: m.recordAudit }));
vi.mock('@/lib/notifications/noteMention', () => ({ notifyNoteMention: m.notifyNoteMention }));
vi.mock('@/lib/services/staffChat/mentions', () => ({
  listColleagues: m.listColleagues,
  extractMentions: m.extractMentions,
}));
vi.mock('@/lib/logging', () => ({ log: { warn: m.warn, error: vi.fn(), info: vi.fn() } }));

import { addDialogNote, DIALOG_NOTE_MAX } from '@/lib/services/messengers/note';

/**
 * Внутренняя заметка в диалоге (`У-209`, спека этапа 3 §3.5).
 *
 * Главное здесь — не «сохранилось ли», а два запрета: заметка не уходит
 * клиенту (в сервисе нет пути в транспорт) и не двигает статус диалога
 * (обсуждение коллег не снимает диалог с контроля SLA).
 */
const dialogFindUnique = vi.fn();
const dialogUpdate = vi.fn();
const messageCreate = vi.fn();
const prisma = {
  messengerDialog: { findUnique: dialogFindUnique, update: dialogUpdate },
  messengerMessage: { create: messageCreate },
} as unknown as PrismaClient;

const session = { sub: 'me', role: 'manager', companyId: 'c1' } as SessionPayload;
const own = { id: 'd1', companyId: 'c1', organizationId: 'o1' };

describe('addDialogNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dialogFindUnique.mockResolvedValue(own);
    dialogUpdate.mockResolvedValue({});
    messageCreate.mockResolvedValue({ id: 'mm1' });
    m.listColleagues.mockResolvedValue({ ok: true, rows: [{ id: 'u2', name: 'Иван Петров' }] });
    m.extractMentions.mockReturnValue([]);
    m.notifyNoteMention.mockResolvedValue(1);
  });

  it('сессия без компании → forbidden, база не спрашивается', async () => {
    const r = await addDialogNote(
      prisma,
      { ...session, companyId: null },
      { dialogId: 'd1', text: 'привет' }
    );
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(dialogFindUnique).not.toHaveBeenCalled();
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it('чужой диалог и несуществующий → not_found, заметка не пишется', async () => {
    dialogFindUnique.mockResolvedValueOnce({ ...own, companyId: 'c2' });
    await expect(addDialogNote(prisma, session, { dialogId: 'd1', text: 'x' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    dialogFindUnique.mockResolvedValueOnce(null);
    await expect(addDialogNote(prisma, session, { dialogId: 'нет', text: 'x' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it('пустой текст и текст из одних пробелов → invalid', async () => {
    await expect(addDialogNote(prisma, session, { dialogId: 'd1', text: '' })).resolves.toEqual({
      ok: false,
      error: 'invalid',
    });
    await expect(
      addDialogNote(prisma, session, { dialogId: 'd1', text: '   \n ' })
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it('текст длиннее предела → text_too_long, ровно по пределу — проходит', async () => {
    await expect(
      addDialogNote(prisma, session, { dialogId: 'd1', text: 'я'.repeat(DIALOG_NOTE_MAX + 1) })
    ).resolves.toEqual({ ok: false, error: 'text_too_long' });
    expect(messageCreate).not.toHaveBeenCalled();

    await expect(
      addDialogNote(prisma, session, { dialogId: 'd1', text: 'я'.repeat(DIALOG_NOTE_MAX) })
    ).resolves.toEqual({ ok: true, messageId: 'mm1' });
  });

  it('успех пишет сообщение с направлением note и статусом sent', async () => {
    const r = await addDialogNote(prisma, session, {
      dialogId: 'd1',
      text: '  клиент торопится  ',
    });
    expect(r).toEqual({ ok: true, messageId: 'mm1' });
    expect(messageCreate).toHaveBeenCalledWith({
      data: {
        dialogId: 'd1',
        direction: 'note',
        body: 'клиент торопится',
        authorId: 'me',
        deliveryStatus: 'sent',
      },
      select: { id: true },
    });
  });

  it('в превью списка идёт ПОМЕТКА БЕЗ ТЕКСТА заметки', async () => {
    // Превью лежит на самом диалоге и нигде не фильтруется по направлению:
    // список диалогов в кабинете клиента (`У-212`) показал бы первые двести
    // символов внутреннего обсуждения. Поэтому текста там нет вовсе.
    await addDialogNote(prisma, session, {
      dialogId: 'd1',
      text: 'клиент врёт про оплату, счёт не выставляем',
    });
    const data = dialogUpdate.mock.calls[0][0].data;
    expect(data.lastMessagePreview).toBe('Внутренняя заметка');
    expect(String(data.lastMessagePreview)).not.toContain('оплату');
    expect(data.lastMessageDirection).toBe('note');
    expect(data.lastMessageAt).toBeInstanceOf(Date);
  });

  it('заметка НЕ двигает статус диалога и не сбрасывает отсчёт SLA', async () => {
    await addDialogNote(prisma, session, { dialogId: 'd1', text: 'обсудим на планёрке' });
    const data = dialogUpdate.mock.calls[0][0].data;
    // Обсуждение между коллегами — не ответ клиенту: снимать диалог с контроля
    // нельзя, иначе просроченный диалог «вылечивался» бы заметкой.
    expect(Object.keys(data)).not.toContain('status');
    expect(Object.keys(data)).not.toContain('waitingSince');
    expect(Object.keys(data)).not.toContain('unreadCount');
  });

  it('аудит пишется действием dialog_note_added с id сообщения', async () => {
    await addDialogNote(prisma, session, { dialogId: 'd1', text: 'важно' });
    expect(m.recordAudit).toHaveBeenCalledWith(prisma, {
      action: 'dialog_note_added',
      entity: 'messenger_dialog',
      entityId: 'd1',
      userId: 'me',
      after: { messageId: 'mm1' },
    });
  });

  it('@упоминание зовёт общий продьюсер note_mention с entity dialog и без автора', async () => {
    m.extractMentions.mockReturnValue(['u2', 'me']);
    await addDialogNote(prisma, session, { dialogId: 'd1', text: 'посмотри @Иван Петров' });
    expect(m.listColleagues).toHaveBeenCalledWith(prisma, session);
    expect(m.notifyNoteMention).toHaveBeenCalledWith(prisma, {
      // Себя в списке нет: автор не уведомляет сам себя.
      mentionedUserIds: ['u2'],
      entity: 'dialog',
      entityId: 'd1',
      noteId: 'mm1',
      body: 'посмотри @Иван Петров',
      managerPath: '/manager/messengers/d1',
    });
  });

  it('текст без «@» коллег не ищет — лишнего запроса к базе нет', async () => {
    await addDialogNote(prisma, session, { dialogId: 'd1', text: 'без упоминаний' });
    expect(m.listColleagues).not.toHaveBeenCalled();
    expect(m.notifyNoteMention).not.toHaveBeenCalled();
  });

  it('сбой поиска коллег не отменяет уже сохранённую заметку', async () => {
    m.listColleagues.mockRejectedValueOnce(new Error('база недоступна'));
    await expect(
      addDialogNote(prisma, session, { dialogId: 'd1', text: 'позови @Иван Петров' })
    ).resolves.toEqual({ ok: true, messageId: 'mm1' });
    expect(m.warn).toHaveBeenCalled();
  });

  it('сбой не-ошибкой (строкой) тоже не отменяет заметку и пишется в журнал', async () => {
    // Бросить можно что угодно, не только Error: журнал не должен упасть на
    // попытке прочитать `.message` у строки.
    m.listColleagues.mockRejectedValueOnce('внезапно строка');
    await expect(
      addDialogNote(prisma, session, { dialogId: 'd1', text: 'позови @Иван Петров' })
    ).resolves.toEqual({ ok: true, messageId: 'mm1' });
    expect(m.warn).toHaveBeenCalledWith(
      expect.stringContaining('mention notify failed'),
      expect.objectContaining({ error: 'внезапно строка' })
    );
  });

  it('диалог общей очереди (companyId=null) доступен сотруднику — так же, как ответ клиенту', async () => {
    dialogFindUnique.mockResolvedValueOnce({ ...own, companyId: null });
    await expect(
      addDialogNote(prisma, session, { dialogId: 'd1', text: 'ничей диалог' })
    ).resolves.toEqual({ ok: true, messageId: 'mm1' });
  });
});
