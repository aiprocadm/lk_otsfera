// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { generateTelegramLinkAction, unlinkTelegramAction } = vi.hoisted(() => ({
  generateTelegramLinkAction: vi.fn(),
  unlinkTelegramAction: vi.fn(),
}));
vi.mock('@/server-actions/telegram', () => ({ generateTelegramLinkAction, unlinkTelegramAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { TelegramLinkCard } from '@/components/settings/telegram-link-card';

describe('TelegramLinkCard (interactions, Pattern I)', () => {
  beforeEach(() => {
    refresh.mockClear();
    generateTelegramLinkAction.mockReset();
    unlinkTelegramAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it('generate link success: shows the deep-link anchor and its hint', async () => {
    generateTelegramLinkAction.mockResolvedValue({ ok: true, deepLink: 'https://t.me/deep' });
    render(React.createElement(TelegramLinkCard, { status: { linked: false, enabled: true } }));

    fireEvent.click(screen.getByRole('button', { name: 'Привязать Telegram' }));

    const link = await screen.findByRole('link', { name: 'Открыть в Telegram' });
    expect(link.getAttribute('href')).toBe('https://t.me/deep');
    expect(
      screen.getByText('Откройте ссылку и нажмите Старт в Telegram, затем обновите страницу.')
    ).toBeTruthy();
  });

  it('generate link error: toasts the mapped message via errorMessageRu fallback, no anchor rendered', async () => {
    generateTelegramLinkAction.mockResolvedValue({ ok: false, error: 'weird_code' });
    render(React.createElement(TelegramLinkCard, { status: { linked: false, enabled: true } }));

    fireEvent.click(screen.getByRole('button', { name: 'Привязать Telegram' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось создать ссылку.'));
    expect(screen.queryByRole('link', { name: 'Открыть в Telegram' })).toBeNull();
  });

  it('unlink flow: calls unlinkTelegramAction, toasts success, and refreshes', async () => {
    unlinkTelegramAction.mockResolvedValue(undefined);
    render(React.createElement(TelegramLinkCard, { status: { linked: true, enabled: true } }));

    fireEvent.click(screen.getByRole('button', { name: 'Отвязать' }));

    await waitFor(() => expect(unlinkTelegramAction).toHaveBeenCalled());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Telegram отвязан'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
