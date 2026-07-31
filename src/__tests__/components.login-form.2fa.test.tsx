// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { LoginForm } from '@/components/auth/login-form';

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function reachCodeStep(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true, twoFactorRequired: true }));
  render(React.createElement(LoginForm, null));
  fireEvent.change(screen.getByPlaceholderText('admin@company.ru'), {
    target: { value: 'm@x.ru' },
  });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByText('Введите код из письма');
}

// Fake-timer вариант: таймеры включены ДО рендера (иначе интервал кулдауна
// создаётся на реальных таймерах и advanceTimersByTime его не двигает).
// Промисы fetch-цепочки прогоняем через act, findBy* под фейком не работает.
async function reachCodeStepFake(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true, twoFactorRequired: true }));
  render(React.createElement(LoginForm, null));
  fireEvent.change(screen.getByPlaceholderText('admin@company.ru'), {
    target: { value: 'm@x.ru' },
  });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('LoginForm — 2FA step', () => {
  beforeEach(() => {
    push.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('twoFactorRequired switches to the code step without navigating', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await reachCodeStep(fetchMock);

    expect(push).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Код из письма или код восстановления')).toBeTruthy();
    expect(screen.getByText('Мы отправили код на вашу почту.')).toBeTruthy();
    // Демо-блок скрыт на шаге кода, кулдаун ресенда активен
    expect(screen.queryByText('Демо-доступ')).toBeNull();
    expect((screen.getByText(/Отправить ещё раз \(\d+с\)/) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('submitting the code verifies and navigates to /dashboard', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await reachCodeStep(fetchMock);

    fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true }));
    fireEvent.change(screen.getByPlaceholderText('Код из письма или код восстановления'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
  });

  it('INVALID_CODE shows the RU error and stays on the code step', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await reachCodeStep(fetchMock);

    fetchMock.mockResolvedValueOnce(jsonRes(401, { code: 'INVALID_CODE' }));
    fireEvent.change(screen.getByPlaceholderText('Код из письма или код восстановления'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(await screen.findByText('Код недействителен или истёк.')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('verify error without a code field falls back to the default RU message', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await reachCodeStep(fetchMock);

    fetchMock.mockResolvedValueOnce(jsonRes(401, {})); // тело без code → ветка ': '''
    fireEvent.change(screen.getByPlaceholderText('Код из письма или код восстановления'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(await screen.findByText('Неверный код.')).toBeTruthy();
  });

  it('network failure during verification shows the network error', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await reachCodeStep(fetchMock);

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fireEvent.change(screen.getByPlaceholderText('Код из письма или код восстановления'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    expect(await screen.findByText('Ошибка сети. Попробуйте ещё раз.')).toBeTruthy();
  });

  it('resend is disabled during the cooldown and fires after it elapses', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await reachCodeStepFake(fetchMock);

    // Во время кулдауна кнопка задизейблена и подписана «(Nс)»
    expect((screen.getByText(/Отправить ещё раз \(\d+с\)/) as HTMLButtonElement).disabled).toBe(
      true
    );

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    const resendBtn = screen.getByRole('button', {
      name: 'Отправить код ещё раз',
    }) as HTMLButtonElement;
    expect(resendBtn.disabled).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true }));
    await act(async () => {
      fireEvent.click(resendBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Код отправлен повторно.')).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/2fa/resend', { method: 'POST' });
    // Кулдаун снова активен
    expect(screen.getByText(/Отправить ещё раз \(\d+с\)/)).toBeTruthy();
  });

  it('resend failure surfaces the RU error (429)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await reachCodeStepFake(fetchMock);

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    fetchMock.mockResolvedValueOnce(jsonRes(429, { code: 'TOO_MANY_REQUESTS' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отправить код ещё раз' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Слишком много запросов. Попробуйте позже.')).toBeTruthy();
  });

  it('resend error without a code field falls back to the default RU message', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await reachCodeStepFake(fetchMock);

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    fetchMock.mockResolvedValueOnce(jsonRes(500, {})); // тело без code
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отправить код ещё раз' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Не удалось отправить код.')).toBeTruthy();
  });

  it('resend network failure shows the network error', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await reachCodeStepFake(fetchMock);

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отправить код ещё раз' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Ошибка сети. Попробуйте ещё раз.')).toBeTruthy();
  });

  it('«Назад» returns to the credentials step and clears state', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await reachCodeStep(fetchMock);

    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));

    expect(screen.getByPlaceholderText('admin@company.ru')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Код из письма или код восстановления')).toBeNull();
  });
});
