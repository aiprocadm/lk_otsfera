// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import {
  IntegrationSettingsForm,
  type IntegrationFormField
} from '@/components/admin/integration-settings-form';

const action = vi.fn();

const FIELDS: IntegrationFormField[] = [
  { name: 'g_username', label: 'Имя бота', kind: 'text', initialValue: 'bot1', placeholder: 'ph-user' },
  { name: 'g_token', label: 'Токен', kind: 'secret', placeholder: 'ph-token', secretSet: false, secretSource: 'none' },
  { name: 'g_tls', label: 'TLS', kind: 'checkbox', initialChecked: true },
  {
    name: 'g_mode',
    label: 'Режим',
    kind: 'select',
    initialValue: 'b',
    options: [
      { value: 'a', label: 'Вариант А' },
      { value: 'b', label: 'Вариант Б' }
    ]
  }
];

function renderForm(overrides?: Partial<React.ComponentProps<typeof IntegrationSettingsForm>>) {
  return render(
    React.createElement(IntegrationSettingsForm, {
      title: 'Группа',
      description: 'Описание группы',
      action,
      fields: FIELDS,
      ...overrides
    })
  );
}

describe('IntegrationSettingsForm', () => {
  beforeEach(() => action.mockReset());

  it('рендерит все виды полей с начальными значениями', () => {
    renderForm({ note: 'Включается флагом на сервере' });
    expect(screen.getByText('Группа')).toBeTruthy();
    expect(screen.getByText('Описание группы')).toBeTruthy();
    expect(screen.getByText('Включается флагом на сервере')).toBeTruthy();
    expect((screen.getByPlaceholderText('ph-user') as HTMLInputElement).value).toBe('bot1');
    const secret = screen.getByPlaceholderText('ph-token') as HTMLInputElement;
    expect(secret.type).toBe('password');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('b');
    expect(screen.getByText('Вариант А')).toBeTruthy();
  });

  it('заданный секрет: подсказка «задан (в конфиге сервера)» и placeholder «оставьте пустым»', () => {
    renderForm({
      fields: [{ name: 's', label: 'Секрет', kind: 'secret', secretSet: true, secretSource: 'env' }]
    });
    expect(screen.getByText(/задан/)).toBeTruthy();
    expect(screen.getByText(/в конфиге сервера/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/оставьте пустым/)).toBeTruthy();
  });

  it('select без options рендерит пустой список (defensive-ветка)', () => {
    renderForm({ fields: [{ name: 'm', label: 'Режим', kind: 'select' }] });
    expect((screen.getByRole('combobox') as HTMLSelectElement).options.length).toBe(0);
  });

  it('заданный секрет из БД — без пометки про конфиг сервера', () => {
    renderForm({
      fields: [{ name: 's', label: 'Секрет', kind: 'secret', secretSet: true, secretSource: 'db' }]
    });
    expect(screen.getByText(/задан/)).toBeTruthy();
    expect(screen.queryByText(/в конфиге сервера/)).toBeNull();
  });

  it('success: показывает подтверждение сохранения', async () => {
    action.mockResolvedValue({ ok: true });
    renderForm();
    fireEvent.submit(screen.getByText('Сохранить').closest('form')!);
    expect(await screen.findByText('Настройки сохранены.')).toBeTruthy();
  });

  it('validation-ошибка: показывает замапленное сообщение в role=alert', async () => {
    action.mockResolvedValue({ ok: false, error: 'validation' });
    renderForm();
    fireEvent.submit(screen.getByText('Сохранить').closest('form')!);
    expect(await screen.findByText('Проверьте заполнение полей.')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
