// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

import { LogoutButton } from '@/components/ui/logout-button';

describe('LogoutButton', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('рендерит кнопку с единым текстом «Выйти» (не «Выход»)', () => {
    render(React.createElement(LogoutButton));
    const button = screen.getByRole('button', { name: 'Выйти' });
    expect(button.getAttribute('type')).toBe('button');
    expect(screen.queryByText('Выход')).toBeNull();
  });

  it('принимает className для тёмной шапки партнёра', () => {
    render(React.createElement(LogoutButton, { className: 'text-gray-400' }));
    const button = screen.getByRole('button', { name: 'Выйти' });
    expect(button.className).toContain('text-gray-400');
  });

  it('success path: POST /api/auth/logout, показывает busy-лейбл, затем push(/login) + refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(LogoutButton));
    const button = screen.getByRole('button', { name: 'Выйти' });
    fireEvent.click(button);

    // busy-лейбл виден сразу после клика, кнопка задизейблена
    expect(await screen.findByRole('button', { name: 'Выходим…' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Выходим…' }) as HTMLButtonElement).disabled).toBe(true);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(refresh).toHaveBeenCalled();
  });

  it('catch path: сетевая ошибка всё равно уводит на /login', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(LogoutButton));
    const button = screen.getByRole('button', { name: 'Выйти' });
    fireEvent.click(button);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(refresh).toHaveBeenCalled();
  });
});
