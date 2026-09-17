// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const { updateDigestSettingsAction } = vi.hoisted(() => ({ updateDigestSettingsAction: vi.fn() }));
vi.mock('@/server-actions/notification-digest', () => ({ updateDigestSettingsAction }));
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DigestSettingsCard } from '@/components/settings/digest-settings-card';

/** Карточка «Дайджест раз в день» (`У-230`): три вопроса, галочка, час, отказ сервера. */

const settings = { eligible: true, enabled: false, hourMsk: 9, lastSentAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  updateDigestSettingsAction.mockResolvedValue({
    ok: true,
    settings: { ...settings, enabled: true },
  });
});

describe('DigestSettingsCard', () => {
  it('заголовок, объяснение простыми словами, галочка и час', () => {
    render(<DigestSettingsCard settings={settings} />);
    expect(screen.getByRole('heading', { name: 'Дайджест раз в день' })).toBeTruthy();
    expect(screen.getByText(/одно письмо в выбранный час/)).toBeTruthy();
    const box = screen.getByLabelText('Получать письма дайджестом раз в день') as HTMLInputElement;
    expect(box.checked).toBe(false);
    const hour = screen.getByLabelText('Час отправки дайджеста') as HTMLSelectElement;
    expect(hour.value).toBe('9');
    // Час не имеет смысла без дайджеста — недоступен, пока не включили.
    expect(hour.disabled).toBe(true);
  });

  it('включение шлёт (true, час) и обновляет страницу', async () => {
    render(<DigestSettingsCard settings={settings} />);
    fireEvent.click(screen.getByLabelText('Получать письма дайджестом раз в день'));
    await waitFor(() => expect(updateDigestSettingsAction).toHaveBeenCalledWith(true, 9));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Дайджест включён — в 09:00');
  });

  it('смена часа при включённом дайджесте', async () => {
    render(<DigestSettingsCard settings={{ ...settings, enabled: true }} />);
    fireEvent.change(screen.getByLabelText('Час отправки дайджеста'), { target: { value: '18' } });
    await waitFor(() => expect(updateDigestSettingsAction).toHaveBeenCalledWith(true, 18));
    expect(toastSuccess).toHaveBeenCalledWith('Дайджест включён — в 18:00');
  });

  it('выключение', async () => {
    render(<DigestSettingsCard settings={{ ...settings, enabled: true }} />);
    fireEvent.click(screen.getByLabelText('Получать письма дайджестом раз в день'));
    await waitFor(() => expect(updateDigestSettingsAction).toHaveBeenCalledWith(false, 9));
    expect(toastSuccess).toHaveBeenCalledWith('Дайджест выключен');
  });

  it('отказ сервера — русский текст, галочка возвращается, страница не обновляется', async () => {
    updateDigestSettingsAction.mockResolvedValue({ ok: false, error: 'invalid_hour' });
    render(<DigestSettingsCard settings={settings} />);
    fireEvent.click(screen.getByLabelText('Получать письма дайджестом раз в день'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain('от 0 до 23');
    expect(
      (screen.getByLabelText('Получать письма дайджестом раз в день') as HTMLInputElement).checked
    ).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('роли, которой дайджест не положен, карточка не показывается', () => {
    const { container } = render(
      <DigestSettingsCard settings={{ ...settings, eligible: false }} />
    );
    expect(container.querySelector('[data-testid="digest-settings-card"]')).toBeNull();
  });
});
