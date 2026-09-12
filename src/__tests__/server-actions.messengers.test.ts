import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  requireManager: vi.fn(),
  revalidatePath: vi.fn(),
  sendDialogMessage: vi.fn(),
  bindDialog: vi.fn(),
  setDialogStatus: vi.fn(),
  startDialog: vi.fn(),
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
vi.mock('@/lib/services/messengers/status', () => ({ setDialogStatus: m.setDialogStatus }));
vi.mock('@/lib/services/messengers/start', () => ({ startDialog: m.startDialog }));

import {
  bindDialogAction,
  sendDialogMessageAction,
  setDialogStatusAction,
  startDialogAction,
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
