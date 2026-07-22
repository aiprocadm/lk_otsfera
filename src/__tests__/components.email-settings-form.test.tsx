// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { saveEmailSettingsAction } = vi.hoisted(() => ({ saveEmailSettingsAction: vi.fn() }));
vi.mock('@/server-actions/admin/integrationSettings', () => ({ saveEmailSettingsAction }));

import { EmailSettingsForm } from '@/components/admin/email-settings-form';

const BASE = { initialEnabled: false, initialFrom: '', apiKeySet: false, apiKeySource: 'none' as const };

describe('EmailSettingsForm', () => {
  beforeEach(() => saveEmailSettingsAction.mockReset());

  it('renders fields; reflects initial enabled + from; shows re_ placeholder when no key', () => {
    render(React.createElement(EmailSettingsForm, { ...BASE, initialEnabled: true, initialFrom: 'x@y.ru' }));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByPlaceholderText('no-reply@otsfera.ru') as HTMLInputElement).value).toBe('x@y.ru');
    expect(screen.getByPlaceholderText('re_...')).toBeTruthy();
  });

  it('shows "задан" hint (with env note) when the key is set from env', () => {
    render(React.createElement(EmailSettingsForm, { ...BASE, apiKeySet: true, apiKeySource: 'env' }));
    expect(screen.getByText(/задан/)).toBeTruthy();
    expect(screen.getByText(/в конфиге сервера/)).toBeTruthy();
    // placeholder switches to the "leave empty to keep" hint
    expect(screen.getByPlaceholderText(/оставьте пустым/)).toBeTruthy();
  });

  it('success: shows the saved confirmation', async () => {
    saveEmailSettingsAction.mockResolvedValue({ ok: true });
    render(React.createElement(EmailSettingsForm, { ...BASE }));
    fireEvent.submit(screen.getByText('Сохранить').closest('form')!);
    expect(await screen.findByText('Настройки сохранены.')).toBeTruthy();
  });

  it('error secrets_key_missing: shows the mapped message', async () => {
    saveEmailSettingsAction.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    render(React.createElement(EmailSettingsForm, { ...BASE }));
    fireEvent.submit(screen.getByText('Сохранить').closest('form')!);
    expect(await screen.findByText(/ключ шифрования \(APP_ENCRYPTION_KEY\)/)).toBeTruthy();
  });
});
