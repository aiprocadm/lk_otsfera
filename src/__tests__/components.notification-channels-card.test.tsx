// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { updateChannelPreferenceAction, saveWhatsappPhoneAction } = vi.hoisted(() => ({
  updateChannelPreferenceAction: vi.fn(),
  saveWhatsappPhoneAction: vi.fn()
}));
vi.mock('@/server-actions/notification-channels', () => ({ updateChannelPreferenceAction, saveWhatsappPhoneAction }));

const { generateMaxLinkAction, unlinkMaxAction } = vi.hoisted(() => ({
  generateMaxLinkAction: vi.fn(),
  unlinkMaxAction: vi.fn()
}));
vi.mock('@/server-actions/max', () => ({ generateMaxLinkAction, unlinkMaxAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { NotificationChannelsCard } from '@/components/settings/notification-channels-card';
import type { NotificationSettingsView } from '@/lib/services/notifications/preferences';

const allUnavailable: NotificationSettingsView = {
  emailAlwaysOn: true,
  telegram: { available: false, linked: false, enabled: false },
  max: { available: false, linked: false, enabled: false },
  whatsapp: { available: false, phone: null, enabled: false }
};

describe('NotificationChannelsCard', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    updateChannelPreferenceAction.mockReset();
    saveWhatsappPhoneAction.mockReset();
    generateMaxLinkAction.mockReset();
    unlinkMaxAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it('always renders the Email row as always-on, hides other channels when unavailable', () => {
    render(React.createElement(NotificationChannelsCard, { settings: allUnavailable }));
    expect(screen.getByText('Всегда включён')).toBeTruthy();
    expect(screen.queryByText('Telegram')).toBeNull();
    expect(screen.queryByText('Max')).toBeNull();
    expect(screen.queryByText('WhatsApp')).toBeNull();
  });

  it('Telegram section: shows not-linked hint when unlinked, toggle disabled', () => {
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      telegram: { available: true, linked: false, enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    expect(screen.getByText('Telegram')).toBeTruthy();
    expect(screen.getByText('Привяжите Telegram в карточке выше, чтобы получать уведомления.')).toBeTruthy();
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(false);
    expect(screen.getByText('Выключен')).toBeTruthy();
  });

  it('Telegram toggle success: calls updateChannelPreferenceAction, toasts, and refreshes', async () => {
    updateChannelPreferenceAction.mockResolvedValue({ ok: true });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      telegram: { available: true, linked: true, enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    expect(screen.getByText('Выключен')).toBeTruthy();
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
    fireEvent.click(checkbox);

    await waitFor(() => expect(updateChannelPreferenceAction).toHaveBeenCalledWith('telegram', true));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Канал включён'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('Telegram toggle to disabled: toasts "Канал выключен"', async () => {
    updateChannelPreferenceAction.mockResolvedValue({ ok: true });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      telegram: { available: true, linked: true, enabled: true }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);

    await waitFor(() => expect(updateChannelPreferenceAction).toHaveBeenCalledWith('telegram', false));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Канал выключен'));
  });

  it('Telegram toggle error: toasts the mapped error message', async () => {
    updateChannelPreferenceAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      telegram: { available: true, linked: true, enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('Max section (not linked, no deep link yet): shows "Привязать Max" button', () => {
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      max: { available: true, linked: false, enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    expect(screen.getByRole('button', { name: 'Привязать Max' })).toBeTruthy();
  });

  it('Max: generate link success shows the deep-link anchor', async () => {
    generateMaxLinkAction.mockResolvedValue({ ok: true, deepLink: 'https://max.link/x' });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      max: { available: true, linked: false, enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать Max' }));

    const link = await screen.findByRole('link', { name: 'Открыть в Max' });
    expect(link.getAttribute('href')).toBe('https://max.link/x');
  });

  it('Max: generate link error toasts the mapped message', async () => {
    generateMaxLinkAction.mockResolvedValue({ ok: false, error: 'storage' });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      max: { available: true, linked: false, enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    fireEvent.click(screen.getByRole('button', { name: 'Привязать Max' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось загрузить файл. Попробуйте ещё раз.'));
    expect(screen.queryByRole('link', { name: 'Открыть в Max' })).toBeNull();
  });

  it('Max toggle: clicking the checkbox calls updateChannelPreferenceAction("max", …)', async () => {
    updateChannelPreferenceAction.mockResolvedValue({ ok: true });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      max: { available: true, linked: true, enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(updateChannelPreferenceAction).toHaveBeenCalledWith('max', true));
  });

  it('Max (linked): shows "Отвязать Max" and unlinking toasts + refreshes', async () => {
    unlinkMaxAction.mockResolvedValue(undefined);
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      max: { available: true, linked: true, enabled: true }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    fireEvent.click(screen.getByRole('button', { name: 'Отвязать Max' }));

    await waitFor(() => expect(unlinkMaxAction).toHaveBeenCalled());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Max отвязан'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('WhatsApp section: renders phone input pre-filled, not-linked hint when no phone', () => {
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      whatsapp: { available: true, phone: null, enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    expect(screen.getByText('Укажите номер телефона, чтобы получать уведомления в WhatsApp.')).toBeTruthy();
    const input = screen.getByLabelText('Номер телефона') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('WhatsApp: save success with a phone toasts "Номер сохранён" and refreshes', async () => {
    saveWhatsappPhoneAction.mockResolvedValue({ ok: true, phone: '+79000000000' });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      whatsapp: { available: true, phone: '', enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    const input = screen.getByLabelText('Номер телефона');
    fireEvent.change(input, { target: { value: '+79000000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(saveWhatsappPhoneAction).toHaveBeenCalledWith('+79000000000'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Номер сохранён'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('WhatsApp: save success with an empty phone (removal) toasts "Номер удалён"', async () => {
    saveWhatsappPhoneAction.mockResolvedValue({ ok: true, phone: null });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      whatsapp: { available: true, phone: '+79000000000', enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    const input = screen.getByLabelText('Номер телефона');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Номер удалён'));
  });

  it('WhatsApp: save error sets the inline field error (no toast) and clears when typing again', async () => {
    saveWhatsappPhoneAction.mockResolvedValue({ ok: false, error: 'invalid_phone' });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      whatsapp: { available: true, phone: '123', enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText('Некорректный номер телефона.')).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();

    const input = screen.getByLabelText('Номер телефона');
    fireEvent.change(input, { target: { value: '1234' } });
    expect(screen.queryByText('Некорректный номер телефона.')).toBeNull();
  });

  it('WhatsApp toggle: clicking the checkbox calls updateChannelPreferenceAction("whatsapp", …)', async () => {
    updateChannelPreferenceAction.mockResolvedValue({ ok: true });
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      whatsapp: { available: true, phone: '+79000000000', enabled: false }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(updateChannelPreferenceAction).toHaveBeenCalledWith('whatsapp', true));
  });

  it('WhatsApp toggle: linked is derived from phone presence (checkbox enabled when phone set)', () => {
    const settings: NotificationSettingsView = {
      ...allUnavailable,
      whatsapp: { available: true, phone: '+79000000000', enabled: true }
    };
    render(React.createElement(NotificationChannelsCard, { settings }));
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.checked).toBe(true);
  });
});
