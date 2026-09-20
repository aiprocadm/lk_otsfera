import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  requireManager: vi.fn(),
  revalidatePath: vi.fn(),
  sendDialogMessage: vi.fn(),
  bindDialog: vi.fn(),
  setDialogStatus: vi.fn(),
  startDialog: vi.fn(),
  assignDialog: vi.fn(),
  takeDialog: vi.fn(),
  addDialogNote: vi.fn(),
  applyReplyTemplate: vi.fn(),
  retryDialogMessage: vi.fn(),
}));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled: m.isFeatureEnabled }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager: m.requireManager }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/messengers/send', async () => ({
  ...(await vi.importActual<typeof import('@/lib/services/messengers/send')>(
    '@/lib/services/messengers/send'
  )),
  sendDialogMessage: m.sendDialogMessage,
}));
vi.mock('@/lib/services/messengers/bind', () => ({ bindDialog: m.bindDialog }));
vi.mock('@/lib/services/messengers/assign', () => ({
  assignDialog: m.assignDialog,
  takeDialog: m.takeDialog,
}));
// Частичный мок: предел длины заметки (`DIALOG_NOTE_MAX`) берём настоящий —
// по нему собрана проверка формы.
vi.mock('@/lib/services/messengers/note', async () => ({
  ...(await vi.importActual<typeof import('@/lib/services/messengers/note')>(
    '@/lib/services/messengers/note'
  )),
  addDialogNote: m.addDialogNote,
}));
vi.mock('@/lib/services/replyTemplates/apply', () => ({
  applyReplyTemplate: m.applyReplyTemplate,
}));
vi.mock('@/lib/services/messengers/retry', () => ({
  retryDialogMessage: m.retryDialogMessage,
}));
vi.mock('@/lib/services/messengers/status', () => ({ setDialogStatus: m.setDialogStatus }));
// Частичный мок: подменяем только сам сервис, а реестр каналов «написать
// первым» (`START_FIRST_CHANNELS`) берём НАСТОЯЩИЙ — по нему собран `z.enum`
// формы, и подменять его значило бы проверять выдуманный список вместо живого.
vi.mock('@/lib/services/messengers/start', async () => ({
  ...(await vi.importActual<typeof import('@/lib/services/messengers/start')>(
    '@/lib/services/messengers/start'
  )),
  startDialog: m.startDialog,
}));

import {
  bindDialogAction,
  sendDialogMessageAction,
  setDialogStatusAction,
  startDialogAction,
  assignDialogAction,
  takeDialogAction,
  addDialogNoteAction,
  applyReplyTemplateAction,
  retryDialogMessageAction,
} from '@/server-actions/messengers';

/**
 * Тонкие адаптеры диалогов (спека 2026-09-12 §4): флаг → форма входа → гард
 * → сервис → ревалидация. Логика скоупа живёт в сервисах и здесь замокана.
 */
const SESSION = { sub: 'm1', role: 'manager', companyId: 'c1' };

describe('server-actions/messengers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.isFeatureEnabled.mockReturnValue(true);
    m.requireManager.mockResolvedValue(SESSION);
  });

  it('флаг inbound_messaging выключен → forbidden, сервисы и гард не зовутся', async () => {
    m.isFeatureEnabled.mockReturnValue(false);
    await expect(sendDialogMessageAction({ dialogId: 'd1', text: 'x' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    await expect(bindDialogAction({ dialogId: 'd1', organizationId: 'o1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    await expect(setDialogStatusAction({ dialogId: 'd1', status: 'closed' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    await expect(
      startDialogAction({ kind: 'user', id: 'u1', channel: 'telegram' })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    expect(m.requireManager).not.toHaveBeenCalled();
    expect(m.isFeatureEnabled).toHaveBeenCalledWith('inbound_messaging');
  });

  it('кривая форма входа → validation до гарда', async () => {
    await expect(sendDialogMessageAction({ dialogId: '', text: 'x' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    await expect(bindDialogAction({ dialogId: 'd1', organizationId: '' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    await expect(
      setDialogStatusAction({ dialogId: 'd1', status: 'archived' as never })
    ).resolves.toEqual({ ok: false, error: 'validation' });
    await expect(startDialogAction({ kind: 'user', id: 'u1', channel: 'sms' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    expect(m.requireManager).not.toHaveBeenCalled();
  });

  it('`У-212`: «написать первым» в кабинет форма не принимает', async () => {
    // Кабинет — канал диалога (его видно в ленте и по нему отвечают), но
    // НАЧАТЬ переписку туда нельзя: диалог кабинета открывает клиент своим
    // вопросом. «Написать первым в кабинет» — это уведомление, у него свой
    // путь. Отказ даёт форма, до гарда и до сервиса.
    await expect(
      startDialogAction({ kind: 'user', id: 'u1', channel: 'cabinet' })
    ).resolves.toEqual({ ok: false, error: 'validation' });
    expect(m.startDialog).not.toHaveBeenCalled();
    expect(m.requireManager).not.toHaveBeenCalled();
  });

  it('почта и мессенджеры форму проходят — сузили ровно на один канал', async () => {
    // Проверка-двойник к предыдущей: если бы `START_FIRST_CHANNELS` случайно
    // опустел или сузился ещё, тест выше остался бы зелёным, а «написать
    // первым» перестало бы работать вообще.
    m.startDialog.mockResolvedValue({ ok: true, dialogId: 'd1' });
    for (const channel of ['telegram', 'max', 'whatsapp', 'email']) {
      m.startDialog.mockClear();
      await startDialogAction({ kind: 'user', id: 'u1', channel });
      expect(m.startDialog, channel).toHaveBeenCalledWith(
        {},
        SESSION,
        expect.objectContaining({ channel })
      );
    }
  });

  it('sendDialogMessageAction: успех и reply_failed перечитывают страницы, прочие отказы — нет', async () => {
    m.sendDialogMessage.mockResolvedValueOnce({ ok: true, messageId: 'mm1' });
    await expect(sendDialogMessageAction({ dialogId: 'd1', text: 'привет' })).resolves.toEqual({
      ok: true,
      messageId: 'mm1',
    });
    expect(m.sendDialogMessage).toHaveBeenCalledWith({}, SESSION, {
      dialogId: 'd1',
      text: 'привет',
    });
    expect(m.revalidatePath).toHaveBeenCalledWith('/manager/messengers');
    expect(m.revalidatePath).toHaveBeenCalledWith('/manager/messengers/d1');

    m.revalidatePath.mockClear();
    m.sendDialogMessage.mockResolvedValueOnce({ ok: false, error: 'reply_failed' });
    await sendDialogMessageAction({ dialogId: 'd1', text: 'x' });
    expect(m.revalidatePath).toHaveBeenCalledTimes(2);

    m.revalidatePath.mockClear();
    m.sendDialogMessage.mockResolvedValueOnce({ ok: false, error: 'invalid' });
    await expect(sendDialogMessageAction({ dialogId: 'd1', text: ' ' })).resolves.toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('bindDialogAction: контакт прокидывается только если задан; успех чистит и очередь триажа', async () => {
    m.bindDialog.mockResolvedValue({ ok: true });
    await bindDialogAction({ dialogId: 'd1', organizationId: 'o1' });
    expect(m.bindDialog).toHaveBeenLastCalledWith({}, SESSION, {
      dialogId: 'd1',
      organizationId: 'o1',
    });
    await bindDialogAction({ dialogId: 'd1', organizationId: 'o1', contactId: 'k1' });
    expect(m.bindDialog).toHaveBeenLastCalledWith({}, SESSION, {
      dialogId: 'd1',
      organizationId: 'o1',
      contactId: 'k1',
    });
    expect(m.revalidatePath).toHaveBeenCalledWith('/manager/inbox');
    expect(m.revalidatePath).toHaveBeenCalledWith('/manager/intake');

    m.revalidatePath.mockClear();
    m.bindDialog.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    await expect(bindDialogAction({ dialogId: 'd1', organizationId: 'o1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('setDialogStatusAction: перечитывает только при реальном изменении', async () => {
    m.setDialogStatus.mockResolvedValueOnce({ ok: true, changed: true });
    await expect(setDialogStatusAction({ dialogId: 'd1', status: 'closed' })).resolves.toEqual({
      ok: true,
      changed: true,
    });
    expect(m.setDialogStatus).toHaveBeenCalledWith({}, SESSION, {
      dialogId: 'd1',
      status: 'closed',
    });
    expect(m.revalidatePath).toHaveBeenCalledTimes(2);

    m.revalidatePath.mockClear();
    m.setDialogStatus.mockResolvedValueOnce({ ok: true, changed: false });
    await setDialogStatusAction({ dialogId: 'd1', status: 'closed' });
    expect(m.revalidatePath).not.toHaveBeenCalled();

    m.setDialogStatus.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    await expect(setDialogStatusAction({ dialogId: 'd1', status: 'open' })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('startDialogAction: успех перечитывает список; отказ сервиса — как есть', async () => {
    m.startDialog.mockResolvedValueOnce({ ok: true, dialogId: 'd9' });
    await expect(
      startDialogAction({ kind: 'contact', id: 'k1', channel: 'whatsapp' })
    ).resolves.toEqual({ ok: true, dialogId: 'd9' });
    expect(m.startDialog).toHaveBeenCalledWith({}, SESSION, {
      kind: 'contact',
      id: 'k1',
      channel: 'whatsapp',
    });
    expect(m.revalidatePath).toHaveBeenCalledWith('/manager/messengers');

    m.revalidatePath.mockClear();
    m.startDialog.mockResolvedValueOnce({ ok: false, error: 'no_messenger_channel' });
    await expect(startDialogAction({ kind: 'user', id: 'u1', channel: 'max' })).resolves.toEqual({
      ok: false,
      error: 'no_messenger_channel',
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

/**
 * Ответственный, заметка, шаблон и повтор (`У-206`, `У-208`, `У-209`,
 * `У-213`).
 *
 * У всех один каркас: выключённый рычаг → `forbidden`, кривой ввод →
 * `validation`, и **лента перечитывается только когда что-то изменилось**.
 * Последнее не мелочь: лишний перечит на каждое нажатие заставляет страницу
 * моргать там, где ничего не произошло.
 */
describe('assignDialogAction / takeDialogAction — ответственный', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.isFeatureEnabled.mockReturnValue(true);
    m.requireManager.mockResolvedValue({ sub: 'u1', role: 'manager', companyId: 'c1' });
  });

  it('выключённый рычаг отвечает «нет доступа», не раскрывая механизм', async () => {
    m.isFeatureEnabled.mockReturnValue(false);

    await expect(assignDialogAction({ dialogId: 'd1', assigneeId: null })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(m.assignDialog).not.toHaveBeenCalled();
  });

  it('пустой номер диалога — отказ до сервиса', async () => {
    await expect(assignDialogAction({ dialogId: '', assigneeId: null })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('снятие ответственного передаёт null, а не пустую строку', async () => {
    m.assignDialog.mockResolvedValue({ ok: true, changed: true });

    const res = await assignDialogAction({ dialogId: 'd1', assigneeId: null });

    expect(res).toEqual({ ok: true, changed: true });
    expect(m.assignDialog).toHaveBeenCalledWith({}, expect.anything(), {
      dialogId: 'd1',
      assigneeId: null,
    });
    expect(m.revalidatePath).toHaveBeenCalled();
  });

  it('ничего не изменилось — ленту не перечитываем', async () => {
    m.assignDialog.mockResolvedValue({ ok: true, changed: false });

    await assignDialogAction({ dialogId: 'd1', assigneeId: 'u2' });

    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('отказ сервиса возвращается как есть', async () => {
    m.assignDialog.mockResolvedValue({ ok: false, error: 'invalid_assignee' });

    await expect(assignDialogAction({ dialogId: 'd1', assigneeId: 'u2' })).resolves.toEqual({
      ok: false,
      error: 'invalid_assignee',
    });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it('«Взять себе» не требует от кнопки моего номера', async () => {
    m.takeDialog.mockResolvedValue({ ok: true, changed: true });

    const res = await takeDialogAction({ dialogId: 'd1' });

    expect(res).toEqual({ ok: true, changed: true });
    expect(m.takeDialog).toHaveBeenCalledWith({}, expect.anything(), { dialogId: 'd1' });
    expect(m.revalidatePath).toHaveBeenCalled();
  });

  it('«Взять себе» при выключённом рычаге тоже закрыто', async () => {
    m.isFeatureEnabled.mockReturnValue(false);

    await expect(takeDialogAction({ dialogId: 'd1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('«Взять себе» с пустым номером — отказ', async () => {
    await expect(takeDialogAction({ dialogId: '' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('диалог уже мой — ленту не трогаем', async () => {
    m.takeDialog.mockResolvedValue({ ok: true, changed: false });

    await takeDialogAction({ dialogId: 'd1' });

    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('addDialogNoteAction — внутренняя заметка', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.isFeatureEnabled.mockReturnValue(true);
    m.requireManager.mockResolvedValue({ sub: 'u1', role: 'manager', companyId: 'c1' });
  });

  it('выключённый рычаг закрывает действие', async () => {
    m.isFeatureEnabled.mockReturnValue(false);

    await expect(addDialogNoteAction({ dialogId: 'd1', text: 'x' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('пустой номер диалога — отказ', async () => {
    await expect(addDialogNoteAction({ dialogId: '', text: 'x' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('заметка сохраняется и лента перечитывается', async () => {
    m.addDialogNote.mockResolvedValue({ ok: true, noteId: 'n1' });

    const res = await addDialogNoteAction({ dialogId: 'd1', text: 'позвонить завтра' });

    expect(res).toEqual({ ok: true, noteId: 'n1' });
    expect(m.revalidatePath).toHaveBeenCalled();
  });

  it('отказ сервиса ленту не трогает', async () => {
    m.addDialogNote.mockResolvedValue({ ok: false, error: 'empty' });

    await addDialogNoteAction({ dialogId: 'd1', text: '' });

    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('applyReplyTemplateAction — вставка шаблона', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.isFeatureEnabled.mockReturnValue(true);
    m.requireManager.mockResolvedValue({ sub: 'u1', role: 'manager', companyId: 'c1' });
  });

  it('выключённый рычаг закрывает действие', async () => {
    m.isFeatureEnabled.mockReturnValue(false);

    await expect(applyReplyTemplateAction({ dialogId: 'd1', templateId: 't1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('пустой номер шаблона — отказ', async () => {
    await expect(applyReplyTemplateAction({ dialogId: 'd1', templateId: '' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('ничего не отправляет — возвращает готовый текст и незаполненные подстановки', async () => {
    m.applyReplyTemplate.mockResolvedValue({ ok: true, text: 'Здравствуйте!', missing: ['цена'] });

    const res = await applyReplyTemplateAction({ dialogId: 'd1', templateId: 't1' });

    expect(res).toEqual({ ok: true, text: 'Здравствуйте!', missing: ['цена'] });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('retryDialogMessageAction — «Повторить»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.isFeatureEnabled.mockReturnValue(true);
    m.requireManager.mockResolvedValue({ sub: 'u1', role: 'manager', companyId: 'c1' });
  });

  it('выключённый рычаг закрывает действие', async () => {
    m.isFeatureEnabled.mockReturnValue(false);

    await expect(retryDialogMessageAction({ dialogId: 'd1', messageId: 'm1' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('пустой номер сообщения — отказ', async () => {
    await expect(retryDialogMessageAction({ dialogId: 'd1', messageId: '' })).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
  });

  it('лента перечитывается и при неудаче — у неё меняется текст причины', async () => {
    m.retryDialogMessage.mockResolvedValue({ ok: false, error: 'channel_down' });

    const res = await retryDialogMessageAction({ dialogId: 'd1', messageId: 'm1' });

    expect(res).toEqual({ ok: false, error: 'channel_down' });
    expect(m.revalidatePath).toHaveBeenCalled();
  });

  it('удачный повтор тоже перечитывает ленту', async () => {
    m.retryDialogMessage.mockResolvedValue({ ok: true });

    await retryDialogMessageAction({ dialogId: 'd1', messageId: 'm1' });

    expect(m.revalidatePath).toHaveBeenCalled();
  });
});
