// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  sendSelfTestMessageAction: vi.fn(),
  checkWebhookAction: vi.fn(),
}));
vi.mock('@/server-actions/admin/integrationSettings', () => actions);

import { ChannelCheckButtons } from '@/components/admin/channel-check-buttons';

/**
 * Две кнопки проверки канала (`У-213`, этап 3 PR-7).
 *
 * Их нажимают ровно тогда, когда что-то не работает, поэтому ответ печатается
 * рядом с кнопкой и остаётся на экране: тост исчез бы через три секунды, а
 * причину отказа человеку нужно перечитать и, скорее всего, показать другому.
 */
beforeEach(() => {
  vi.clearAllMocks();
  actions.sendSelfTestMessageAction.mockResolvedValue({
    ok: true,
    detail: 'Сообщение отправлено.',
  });
  actions.checkWebhookAction.mockResolvedValue({ ok: true, detail: 'Вебхук зарегистрирован.' });
});

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('ChannelCheckButtons — обе проверки на месте', () => {
  it('«Тестовое сообщение себе» зовёт проверку пути НАРУЖУ', async () => {
    render(<ChannelCheckButtons channel="telegram" />);
    press('Тестовое сообщение себе');
    await waitFor(() => expect(actions.sendSelfTestMessageAction).toHaveBeenCalledTimes(1));
    // Канал приходит аргументом, адресата сервер берёт сам — форма его не спрашивает.
    expect(actions.sendSelfTestMessageAction.mock.calls[0][0]).toBe('telegram');
    expect(actions.checkWebhookAction).not.toHaveBeenCalled();
  });

  it('«Проверить вебхук» зовёт проверку пути ВНУТРЬ', async () => {
    render(<ChannelCheckButtons channel="max" />);
    press('Проверить вебхук');
    await waitFor(() => expect(actions.checkWebhookAction).toHaveBeenCalledTimes(1));
    expect(actions.checkWebhookAction.mock.calls[0][0]).toBe('max');
    expect(actions.sendSelfTestMessageAction).not.toHaveBeenCalled();
  });
});

describe('ChannelCheckButtons — результат печатается рядом', () => {
  it('до нажатия на экране ничего лишнего нет', () => {
    render(<ChannelCheckButtons channel="telegram" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('успех — спокойное сообщение (status), а не тревога', async () => {
    render(<ChannelCheckButtons channel="telegram" />);
    press('Тестовое сообщение себе');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Сообщение отправлено.')
    );
  });

  it('причина от провайдера важнее общей подписи', async () => {
    // «Не удалось выполнить проверку» не говорит ничего. «Telegram отклонил
    // отправку (403)» — говорит, куда идти: к ключам бота.
    actions.sendSelfTestMessageAction.mockResolvedValue({
      ok: false,
      error: 'failed',
      reason: 'Telegram отклонил отправку (403)',
    });
    render(<ChannelCheckButtons channel="telegram" />);
    press('Тестовое сообщение себе');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Telegram отклонил отправку (403)')
    );
    expect(screen.getByRole('alert').textContent).not.toContain('Не удалось выполнить проверку');
  });

  it('без причины показывается подпись по коду отказа', async () => {
    actions.sendSelfTestMessageAction.mockResolvedValue({ ok: false, error: 'not_linked' });
    render(<ChannelCheckButtons channel="telegram" />);
    press('Тестовое сообщение себе');
    await waitFor(() =>
      // Подпись объясняет, что делать: привязать мессенджер к своей учётной записи.
      expect(screen.getByRole('alert').textContent).toContain('привяжите его в личных настройках')
    );
  });

  it.each([
    ['channel_unavailable', 'Канал не подключён или проверка для него недоступна.'],
    ['forbidden', 'Недостаточно прав.'],
    ['failed', 'Не удалось выполнить проверку.'],
  ])('код %s подписан по-русски', async (error, text) => {
    actions.checkWebhookAction.mockResolvedValue({ ok: false, error });
    render(<ChannelCheckButtons channel="telegram" />);
    press('Проверить вебхук');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text));
  });

  it('незнакомый код не оставляет человека с пустым местом', async () => {
    actions.checkWebhookAction.mockResolvedValue({ ok: false, error: 'что-то_новое' });
    render(<ChannelCheckButtons channel="telegram" />);
    press('Проверить вебхук');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Проверка не удалась.'));
  });

  it('новая проверка заменяет прежний ответ, а не дописывает второй', async () => {
    actions.checkWebhookAction.mockResolvedValue({ ok: false, error: 'failed' });
    render(<ChannelCheckButtons channel="telegram" />);
    press('Проверить вебхук');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    actions.checkWebhookAction.mockResolvedValue({ ok: true, detail: 'Вебхук зарегистрирован.' });
    press('Проверить вебхук');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Вебхук зарегистрирован.')
    );
    // Старая тревога рядом с новым успехом читалась бы как «и то, и другое».
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
