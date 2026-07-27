// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { revokeMock, toastErrorMock, pushMock, refreshMock } = vi.hoisted(() => ({
  revokeMock: vi.fn(),
  toastErrorMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn()
}));

vi.mock('@/server-actions/security', () => ({ revokeAllSessionsAction: revokeMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

import { SecurityCard } from '@/components/settings/security-card';
import { errorMessageRu } from '@/lib/errors/messages';

beforeEach(() => {
  vi.clearAllMocks();
  revokeMock.mockResolvedValue({ ok: true });
});

describe('SecurityCard', () => {
  it('рисует заголовок, пояснение и кнопку выхода', () => {
    render(React.createElement(SecurityCard, null));

    expect(screen.getByText('Безопасность')).toBeTruthy();
    expect(screen.getByText(/во всех браузерах и на всех устройствах/)).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Выйти на всех устройствах' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('успешный клик — вызывает ревокацию, потом уводит на /login и обновляет роутер', async () => {
    render(React.createElement(SecurityCard, null));

    fireEvent.click(screen.getByRole('button', { name: 'Выйти на всех устройствах' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    expect(revokeMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('forbidden — русский тост об ошибке и никакого редиректа', async () => {
    revokeMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(SecurityCard, null));

    fireEvent.click(screen.getByRole('button', { name: 'Выйти на всех устройствах' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(errorMessageRu('forbidden')));
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('во время выполнения кнопка заблокирована и подписана «Выходим…»', async () => {
    let release: (v: unknown) => void = () => {};
    revokeMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    render(React.createElement(SecurityCard, null));

    fireEvent.click(screen.getByRole('button', { name: 'Выйти на всех устройствах' }));

    await waitFor(() => {
      const pendingButton = screen.getByRole('button', { name: 'Выходим…' }) as HTMLButtonElement;
      expect(pendingButton.disabled).toBe(true);
    });

    release({ ok: true });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });
});
