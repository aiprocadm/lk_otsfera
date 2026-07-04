// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { LoginForm, type DemoLogin } from '@/components/auth/login-form';

const demoLogins: DemoLogin[] = [
  { label: 'Администратор', email: 'admin@company.ru', password: 'admin123' }
];

describe('LoginForm', () => {
  beforeEach(() => {
    push.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders email/password inputs and the submit button, no demo section without demoLogins', () => {
    render(React.createElement(LoginForm, null));
    expect(screen.getByPlaceholderText('admin@company.ru')).toBeTruthy();
    expect(screen.getByPlaceholderText('••••••••')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeTruthy();
    expect(screen.queryByText('Демо-доступ')).toBeNull();
  });

  it('renders the demo logins section when provided, and clicking one fills the form', () => {
    render(React.createElement(LoginForm, { demoLogins }));
    expect(screen.getByText('Демо-доступ')).toBeTruthy();
    fireEvent.click(screen.getByText('Администратор'));

    const emailInput = screen.getByPlaceholderText('admin@company.ru') as HTMLInputElement;
    const passwordInput = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
    expect(emailInput.value).toBe('admin@company.ru');
    expect(passwordInput.value).toBe('admin123');
  });

  it('does not render the demo section when demoLogins is an empty array', () => {
    render(React.createElement(LoginForm, { demoLogins: [] }));
    expect(screen.queryByText('Демо-доступ')).toBeNull();
  });

  it('success: submits JSON body, shows busy label, and pushes to /dashboard', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LoginForm, null));

    fireEvent.change(screen.getByPlaceholderText('admin@company.ru'), { target: { value: 'u@x.ru' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByRole('button', { name: 'Входим...' })).toBeTruthy();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'u@x.ru', password: 'secret' })
    });
  });

  it('error with a known code: maps via errorMessageRu (lowercased) and shows the alert banner', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ code: 'INVALID_CREDENTIALS' })
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LoginForm, null));

    fireEvent.change(screen.getByPlaceholderText('admin@company.ru'), { target: { value: 'u@x.ru' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Неверный email или пароль.')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('error without a usable code: falls back to the default message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({})
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LoginForm, null));

    fireEvent.change(screen.getByPlaceholderText('admin@company.ru'), { target: { value: 'u@x.ru' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Неверный email или пароль.')).toBeTruthy();
  });

  it('error where res.json() itself throws: still falls back gracefully via .catch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error('bad json'))
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LoginForm, null));

    fireEvent.change(screen.getByPlaceholderText('admin@company.ru'), { target: { value: 'u@x.ru' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Неверный email или пароль.')).toBeTruthy();
  });

  it('network error (fetch rejects): shows the network-error message', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LoginForm, null));

    fireEvent.change(screen.getByPlaceholderText('admin@company.ru'), { target: { value: 'u@x.ru' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Ошибка сети. Попробуйте ещё раз.')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('clicking a demo login clears any previous error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(LoginForm, { demoLogins }));

    fireEvent.change(screen.getByPlaceholderText('admin@company.ru'), { target: { value: 'u@x.ru' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    await screen.findByText('Ошибка сети. Попробуйте ещё раз.');

    fireEvent.click(screen.getByText('Администратор'));
    expect(screen.queryByText('Ошибка сети. Попробуйте ещё раз.')).toBeNull();
  });
});
