// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { resendInviteAction } = vi.hoisted(() => ({ resendInviteAction: vi.fn() }));
vi.mock('@/server-actions/invite-resend', () => ({ resendInviteAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { InviteResendButtons } from '@/components/team/invite-resend-buttons';

const okResult = (emailStatus: 'sent' | 'skipped' = 'sent') => ({
  ok: true as const,
  inviteUrl: 'https://lk.example/invite/tok-9',
  emailStatus
});

/** Отложенный промис — для проверки busy-состояний. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('InviteResendButtons', () => {
  beforeEach(() => {
    resendInviteAction.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    setClipboard(vi.fn().mockResolvedValue(undefined));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('«Отправить повторно» при emailStatus=sent: экшен с sendEmail=true и success-тост про письмо', async () => {
    resendInviteAction.mockResolvedValue(okResult('sent'));
    render(React.createElement(InviteResendButtons, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Отправить повторно' }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Письмо приглашения отправлено повторно')
    );
    expect(resendInviteAction).toHaveBeenCalledWith({ userId: 'u1', sendEmail: true });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('«Отправить повторно» при emailStatus=skipped: тост «Почта выключена…»', async () => {
    resendInviteAction.mockResolvedValue(okResult('skipped'));
    render(React.createElement(InviteResendButtons, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Отправить повторно' }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Почта выключена — используйте «Скопировать ссылку»')
    );
  });

  it('«Скопировать ссылку»: экшен с sendEmail=false, writeText со ссылкой, success-тост', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    resendInviteAction.mockResolvedValue(okResult('sent'));
    render(React.createElement(InviteResendButtons, { userId: 'u2' }));

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Ссылка скопирована (прежняя ссылка больше не действует)')
    );
    expect(resendInviteAction).toHaveBeenCalledWith({ userId: 'u2', sendEmail: false });
    expect(writeText).toHaveBeenCalledWith('https://lk.example/invite/tok-9');
  });

  it('сбой clipboard: error-тост с самой ссылкой (запасной канал)', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    resendInviteAction.mockResolvedValue(okResult('sent'));
    render(React.createElement(InviteResendButtons, { userId: 'u2' }));

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Не удалось скопировать — выделите ссылку вручную: https://lk.example/invite/tok-9'
      )
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', 'Недостаточно прав'],
    ['not_found', 'Пользователь не найден или деактивирован'],
    ['already_active', 'Пользователь уже установил пароль'],
    ['rate_limited', 'Слишком много отправок — попробуйте через час']
  ])('код ошибки %s → русский тост «%s»', async (code, message) => {
    resendInviteAction.mockResolvedValue({ ok: false, error: code });
    render(React.createElement(InviteResendButtons, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Отправить повторно' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(message));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('неизвестный код ошибки → общий фолбэк-тост', async () => {
    resendInviteAction.mockResolvedValue({ ok: false, error: 'weird_code' });
    render(React.createElement(InviteResendButtons, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось переотправить приглашение')
    );
  });

  it('сетевой throw экшена → «Сетевая ошибка», кнопки снова активны', async () => {
    resendInviteAction.mockRejectedValue(new Error('offline'));
    render(React.createElement(InviteResendButtons, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Отправить повторно' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
  });

  it('busy email-ветки: подпись «Отправляем…», обе кнопки заблокированы, после ответа разблокированы', async () => {
    const d = deferred<ReturnType<typeof okResult>>();
    resendInviteAction.mockReturnValue(d.promise);
    render(React.createElement(InviteResendButtons, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Отправить повторно' }));

    const emailBtn = await screen.findByRole('button', { name: 'Отправляем…' });
    const copyBtn = screen.getByRole('button', { name: 'Скопировать ссылку' });
    expect((emailBtn as HTMLButtonElement).disabled).toBe(true);
    expect((copyBtn as HTMLButtonElement).disabled).toBe(true);
    // Повторные клики по заблокированным кнопкам не порождают новых вызовов
    fireEvent.click(emailBtn);
    fireEvent.click(copyBtn);
    expect(resendInviteAction).toHaveBeenCalledTimes(1);

    d.resolve(okResult('sent'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отправить повторно' })).toBeTruthy());
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([false, false]);
  });

  it('busy copy-ветки: подпись «Готовим…», обе кнопки заблокированы', async () => {
    const d = deferred<ReturnType<typeof okResult>>();
    resendInviteAction.mockReturnValue(d.promise);
    render(React.createElement(InviteResendButtons, { userId: 'u1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }));

    const copyBtn = await screen.findByRole('button', { name: 'Готовим…' });
    expect((copyBtn as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Отправить повторно' }) as HTMLButtonElement).disabled).toBe(true);

    d.resolve(okResult('sent'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Скопировать ссылку' })).toBeTruthy());
  });
});
