// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ResetPasswordForm } from '@/components/auth/reset-password-form';

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    push.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function inputs() {
    const [passwordInput, confirmInput] = screen.getAllByPlaceholderText('••••••••');
    return { passwordInput, confirmInput };
  }

  it('renders both password inputs and the submit button', () => {
    render(React.createElement(ResetPasswordForm, { token: 't1' }));
    const { passwordInput, confirmInput } = inputs();
    expect(passwordInput).toBeTruthy();
    expect(confirmInput).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Установить пароль' })).toBeTruthy();
  });

  it('too-short password: shows a toast error and does not call fetch', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ResetPasswordForm, { token: 't1' }));
    const { passwordInput, confirmInput } = inputs();

    fireEvent.change(passwordInput, { target: { value: 'short' } });
    fireEvent.change(confirmInput, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }));

    expect(toastError).toHaveBeenCalledWith('Пароль должен быть не короче 8 символов');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mismatched passwords: shows a toast error and does not call fetch', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ResetPasswordForm, { token: 't1' }));
    const { passwordInput, confirmInput } = inputs();

    fireEvent.change(passwordInput, { target: { value: 'longenough1' } });
    fireEvent.change(confirmInput, { target: { value: 'longenough2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }));

    expect(toastError).toHaveBeenCalledWith('Пароли не совпадают');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('success: posts token+password, shows busy label, toasts success, and pushes to /login', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ResetPasswordForm, { token: 'tok-1' }));
    const { passwordInput, confirmInput } = inputs();

    fireEvent.change(passwordInput, { target: { value: 'longenough1' } });
    fireEvent.change(confirmInput, { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }));

    expect(await screen.findByRole('button', { name: 'Сохраняем…' })).toBeTruthy();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/reset-password/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'tok-1', newPassword: 'longenough1' }),
    });
    expect(toastSuccess).toHaveBeenCalledWith('Пароль установлен. Войдите в систему.');
  });

  it('error invalid_token: shows the expired-link message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'invalid_token' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ResetPasswordForm, { token: 't' }));
    const { passwordInput, confirmInput } = inputs();
    fireEvent.change(passwordInput, { target: { value: 'longenough1' } });
    fireEvent.change(confirmInput, { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Ссылка недействительна или истекла. Запросите новую.'
      )
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('error weak_password: shows the weak-password message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'weak_password' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ResetPasswordForm, { token: 't' }));
    const { passwordInput, confirmInput } = inputs();
    fireEvent.change(passwordInput, { target: { value: 'longenough1' } });
    fireEvent.change(confirmInput, { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Слабый пароль (минимум 8 символов).')
    );
  });

  it('error 429: shows the rate-limit message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: 'too_many_requests' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ResetPasswordForm, { token: 't1' }));
    const { passwordInput, confirmInput } = inputs();
    fireEvent.change(passwordInput, { target: { value: 'longenough1' } });
    fireEvent.change(confirmInput, { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Слишком много попыток. Подождите немного и попробуйте снова.'
      )
    );
  });

  it('error with an unmapped code: falls back to the generic message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'weird' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ResetPasswordForm, { token: 't' }));
    const { passwordInput, confirmInput } = inputs();
    fireEvent.change(passwordInput, { target: { value: 'longenough1' } });
    fireEvent.change(confirmInput, { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось установить пароль. Попробуйте ещё раз.')
    );
  });

  it('error where res.json() itself rejects: still falls back gracefully via .catch(null)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.reject(new Error('bad json')) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ResetPasswordForm, { token: 't' }));
    const { passwordInput, confirmInput } = inputs();
    fireEvent.change(passwordInput, { target: { value: 'longenough1' } });
    fireEvent.change(confirmInput, { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Установить пароль' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Не удалось установить пароль. Попробуйте ещё раз.')
    );
  });
});
