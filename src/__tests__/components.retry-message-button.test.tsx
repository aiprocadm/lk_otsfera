// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const actions = vi.hoisted(() => ({ retryDialogMessageAction: vi.fn() }));
vi.mock('@/server-actions/messengers', () => actions);

import { RetryMessageButton } from '@/components/manager/messengers/retry-message-button';
import { DialogThread } from '@/components/manager/messengers/dialog-thread';
import type { DialogMessageView } from '@/lib/services/messengers/get';

/**
 * «Повторить» у недоставленного сообщения (`У-213`, этап 3 PR-7).
 *
 * Две разные вещи проверяются здесь вместе, потому что порознь они бессмысленны:
 * КОГДА кнопка появляется (решает лента) и ЧТО она делает (решает сама кнопка).
 * Кнопка у доставленного сообщения — приглашение отправить клиенту дубль;
 * кнопки нет у неотправленного — тупик, из которого человек выйти не может.
 */
beforeEach(() => {
  vi.clearAllMocks();
  actions.retryDialogMessageAction.mockResolvedValue({ ok: true });
});

const at = new Date('2026-09-15T10:00:00Z');

const msg = (over: Partial<DialogMessageView> = {}): DialogMessageView => ({
  id: 'm1',
  direction: 'out',
  body: 'текст',
  createdAt: at,
  deliveryStatus: 'sent',
  deliveryError: null,
  authorName: 'Мария',
  inboundMessageId: null,
  attachment: null,
  ...over,
});

const thread = (messages: DialogMessageView[]) =>
  renderToString(<DialogThread dialogId="d1" messages={messages} hiddenCount={0} />);

describe('лента: у кого есть кнопка «Повторить»', () => {
  it('у недоставленного исходящего — есть', () => {
    const out = thread([msg({ deliveryStatus: 'failed', deliveryError: 'Бот заблокирован' })]);
    expect(out).toContain('Повторить');
    // Рядом стоит причина: без неё повторять бессмысленно, пока не решена беда.
    expect(out).toContain('Бот заблокирован');
  });

  it('у доставленного — нет: это предложение отправить клиенту дубль', () => {
    expect(thread([msg({ deliveryStatus: 'sent' })])).not.toContain('Повторить');
  });

  it.each(['pending', 'sending'] as const)(
    'у сообщения в состоянии «%s» — нет: оно ещё в пути',
    (deliveryStatus) => {
      expect(thread([msg({ deliveryStatus })])).not.toContain('Повторить');
    }
  );

  it('у входящего — нет: клиенту мы его не отправляли', () => {
    const out = thread([msg({ direction: 'in', deliveryStatus: 'failed', authorName: null })]);
    expect(out).not.toContain('Повторить');
  });

  it('у внутренней заметки — нет: она никуда не отправляется', () => {
    expect(thread([msg({ direction: 'note', deliveryStatus: 'failed' })])).not.toContain(
      'Повторить'
    );
  });

  it('у неотправленного ВЛОЖЕНИЯ кнопки нет — файл ушёл бы дважды', () => {
    // У файла своя дорога: проверка антивирусом и отдельная отправка. Сервис
    // такой повтор всё равно отклоняет (`not_failed`), и кнопка, ведущая в
    // гарантированный отказ, только злит.
    const out = thread([
      msg({
        deliveryStatus: 'failed',
        deliveryError: 'Сеть не ответила',
        attachment: { name: 'счёт.pdf', size: 2048, scanStatus: 'clean' },
      }),
    ]);
    expect(out).toContain('не доставлено');
    expect(out).not.toContain('Повторить');
  });
});

describe('RetryMessageButton — что делает нажатие', () => {
  it('зовёт повтор именно этой реплики и перечитывает ленту', async () => {
    render(<RetryMessageButton dialogId="d1" messageId="m7" />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(actions.retryDialogMessageAction).toHaveBeenCalledWith({
        dialogId: 'd1',
        messageId: 'm7',
      })
    );
    // Без перечитывания пометка «не доставлено» осталась бы на экране после
    // удачного повтора.
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
  });

  it('после успеха тревожной подписи не появляется', async () => {
    render(<RetryMessageButton dialogId="d1" messageId="m7" />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('новая причина отказа показывается вместо общей подписи', async () => {
    // Причина могла ИЗМЕНИТЬСЯ с прошлой попытки: было «сеть недоступна»,
    // стало «бот заблокирован» — это уже не лечится повтором.
    actions.retryDialogMessageAction.mockResolvedValue({
      ok: false,
      error: 'reply_failed',
      reason: 'Клиент заблокировал бота',
    });
    render(<RetryMessageButton dialogId="d1" messageId="m7" />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Клиент заблокировал бота')
    );
    // Лента всё равно перечитывается: в базе обновилась причина у сообщения.
    expect(nav.refresh).toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 'Мессенджеры выключены.'],
    ['not_found', 'Сообщение не найдено — обновите страницу.'],
    ['not_failed', 'Это сообщение уже доставлено или ещё отправляется.'],
    ['channel_unavailable', 'Канал не подключён — обратитесь к администратору.'],
    ['validation', 'Не удалось повторить отправку.'],
  ])('отказ «%s» подписан по-русски', async (error, text) => {
    actions.retryDialogMessageAction.mockResolvedValue({ ok: false, error });
    render(<RetryMessageButton dialogId="d1" messageId="m7" />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text));
  });

  it('незнакомый код отказа не оставляет пустое место', async () => {
    actions.retryDialogMessageAction.mockResolvedValue({ ok: false, error: 'reply_failed' });
    render(<RetryMessageButton dialogId="d1" messageId="m7" />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Не удалось повторить отправку.')
    );
  });

  it('прежняя ошибка стирается перед новой попыткой', async () => {
    actions.retryDialogMessageAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<RetryMessageButton dialogId="d1" messageId="m7" />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    actions.retryDialogMessageAction.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    // Иначе рядом с удачным повтором осталась бы старая тревога.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
