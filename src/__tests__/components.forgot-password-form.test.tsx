// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

const SUCCESS_TEXT = 'Если такой email зарегистрирован, мы отправили письмо со ссылкой для сброса пароля.';
const GENERIC_ERROR = 'Не удалось отправить запрос, попробуйте позже';
const RATE_LIMIT_ERROR = 'Слишком много запросов, попробуйте позже';

function emailInput(): HTMLInputElement {
  return screen.getByLabelText('Email') as HTMLInputElement;
}

function submit(email = 'user@x.ru') {
  fireEvent.change(emailInput(), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить ссылку' }));
}

describe('ForgotPasswordForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a required email input (type=email, autoComplete=email) and the submit button', () => {
    render(React.createElement(ForgotPasswordForm, null));
    const input = emailInput();
    expect(input.required).toBe(true);
    expect(input.type).toBe('email');
    expect(input.autocomplete).toBe('email');
    expect(screen.getByRole('button', { name: 'Отправить ссылку' })).toBeTruthy();
  });

  it('success (2xx): posts {email}, shows busy label, then replaces the form with a status message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ForgotPasswordForm, null));

    submit('user@x.ru');

    expect(await screen.findByRole('button', { name: 'Отправляем…' })).toBeTruthy();
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(SUCCESS_TEXT);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/reset-password/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@x.ru' })
    });
    // Анти-enumeration: форма исчезает целиком, ответ одинаков для любого email
    expect(document.querySelector('form')).toBeNull();
  });

  it('success: moves focus to the status message (form unmount would drop focus to body)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ForgotPasswordForm, null));

    submit();

    const status = await screen.findByRole('status');
    await waitFor(() => expect(document.activeElement).toBe(status));
  });

  it('429: shows the rate-limit inline error and keeps the form', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ForgotPasswordForm, null));

    submit();

    expect(await screen.findByText(RATE_LIMIT_ERROR)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('form')).toBeTruthy();
  });

  it('non-429 error response: shows the generic inline error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ForgotPasswordForm, null));

    submit();

    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('network error (fetch rejects): shows the generic inline error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ForgotPasswordForm, null));

    submit();

    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    expect(document.querySelector('form')).toBeTruthy();
  });

  it('resubmit after an error clears the previous inline error before showing success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(ForgotPasswordForm, null));

    submit();
    await screen.findByText(RATE_LIMIT_ERROR);

    // findBy*: transition может держать pending ещё один коммит после появления
    // ошибки — дожидаемся idle-кнопки, иначе клик попадает в disabled.
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить ссылку' }));
    await waitFor(() => expect(screen.queryByText(RATE_LIMIT_ERROR)).toBeNull());
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});
