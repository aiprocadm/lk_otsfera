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

  it('ключ задан в базе (не в конфиге) → пометка без приписки про сервер', () => {
    // Источник ключа важен админу: из конфига сервера его правкой формы не
    // изменить, из базы — можно. Приписка должна появляться только для конфига.
    render(React.createElement(EmailSettingsForm, { ...BASE, apiKeySet: true, apiKeySource: 'db' }));
    expect(screen.getByText(/задан/)).toBeTruthy();
    expect(screen.queryByText(/в конфиге сервера/)).toBeNull();
  });

  it('переключатель отправки писем меняет состояние', () => {
    // Галочка управляется состоянием, а не формой напрямую: без обработчика она
    // визуально «залипнет» и админ решит, что отправка включена.
    render(React.createElement(EmailSettingsForm, { ...BASE, initialEnabled: false }));
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(true);
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

describe('EmailSettingsForm — панель «Проверить подключение» (ФТ-14.3)', () => {
  beforeEach(() => saveEmailSettingsAction.mockReset());
  it('без testAction панели нет; с testAction — кнопка и строка последней проверки', () => {
    render(React.createElement(EmailSettingsForm, { ...BASE }));
    expect(screen.queryByText('Проверить подключение')).toBeNull();

    const testAction = vi.fn();
    render(
      React.createElement(EmailSettingsForm, {
        ...BASE,
        testAction,
        check: { lastAt: '23.07.2026, 10:00', lastOk: true, lastError: null }
      })
    );
    expect(screen.getByText('Проверить подключение')).toBeTruthy();
    expect(screen.getByText(/Последняя проверка:/)).toBeTruthy();
    expect(screen.getByText('успешно')).toBeTruthy();
  });

  it('клик по кнопке зовёт testAction (тестовое письмо), сохранение не запускается', async () => {
    const testAction = vi.fn().mockResolvedValue({
      ok: true,
      success: true,
      message: 'Тестовое письмо отправлено на a@x.ru'
    });
    render(React.createElement(EmailSettingsForm, { ...BASE, testAction, check: null }));
    const btn = screen.getByText('Проверить подключение');
    fireEvent.click(btn);
    expect(await screen.findByText('Тестовое письмо отправлено на a@x.ru')).toBeTruthy();
    expect(saveEmailSettingsAction).not.toHaveBeenCalled();
  });
});
