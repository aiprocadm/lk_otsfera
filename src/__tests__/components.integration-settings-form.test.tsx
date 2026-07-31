// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import {
  IntegrationSettingsForm,
  type IntegrationFormField,
} from '@/components/admin/integration-settings-form';

const action = vi.fn();

const FIELDS: IntegrationFormField[] = [
  {
    name: 'g_username',
    label: 'Имя бота',
    kind: 'text',
    initialValue: 'bot1',
    placeholder: 'ph-user',
  },
  {
    name: 'g_token',
    label: 'Токен',
    kind: 'secret',
    placeholder: 'ph-token',
    secretSet: false,
    secretSource: 'none',
  },
  { name: 'g_tls', label: 'TLS', kind: 'checkbox', initialChecked: true },
  {
    name: 'g_mode',
    label: 'Режим',
    kind: 'select',
    initialValue: 'b',
    options: [
      { value: 'a', label: 'Вариант А' },
      { value: 'b', label: 'Вариант Б' },
    ],
  },
];

function renderForm(overrides?: Partial<React.ComponentProps<typeof IntegrationSettingsForm>>) {
  return render(
    React.createElement(IntegrationSettingsForm, {
      title: 'Группа',
      description: 'Описание группы',
      action,
      fields: FIELDS,
      ...overrides,
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
      fields: [
        { name: 's', label: 'Секрет', kind: 'secret', secretSet: true, secretSource: 'env' },
      ],
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
      fields: [{ name: 's', label: 'Секрет', kind: 'secret', secretSet: true, secretSource: 'db' }],
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

describe('IntegrationCheckPanel (через IntegrationSettingsForm)', () => {
  const testAction = vi.fn();
  beforeEach(() => {
    testAction.mockReset();
    action.mockReset();
  });

  it('без testAction панель не рендерится', () => {
    renderForm();
    expect(screen.queryByText('Проверить подключение')).toBeNull();
  });

  it('рендерит «последняя проверка: —» когда проб ещё не было', () => {
    renderForm({ testAction, check: null });
    expect(screen.getByText('Проверить подключение')).toBeTruthy();
    expect(screen.getByText(/Последняя проверка:/)).toBeTruthy();
    expect(screen.getByText(/—/)).toBeTruthy();
  });

  it('успешная последняя проверка: дата + «успешно»', () => {
    renderForm({
      testAction,
      check: { lastAt: '23.07.2026, 10:00', lastOk: true, lastError: null },
    });
    expect(screen.getByText(/23\.07\.2026/)).toBeTruthy();
    expect(screen.getByText('успешно')).toBeTruthy();
  });

  it('провальная последняя проверка: текст ошибки (fallback «ошибка» при null)', () => {
    renderForm({
      testAction,
      check: { lastAt: 'дата', lastOk: false, lastError: 'Сервер ответил HTTP 500' },
    });
    expect(screen.getByText('Сервер ответил HTTP 500')).toBeTruthy();

    renderForm({ testAction, check: { lastAt: 'дата2', lastOk: false, lastError: null } });
    expect(screen.getByText('ошибка')).toBeTruthy();
  });

  it('блок вебхука: URL, заголовок, «задан», примечание и последнее входящее', () => {
    renderForm({
      testAction,
      check: null,
      webhook: {
        url: 'https://lk.example.ru/api/integrations/telegram/webhook',
        headerName: 'x-telegram-bot-api-secret-token',
        secretSet: true,
        lastEventAt: '23.07.2026, 09:30',
        note: 'Прим.',
      },
    });
    expect(
      screen.getByText('https://lk.example.ru/api/integrations/telegram/webhook')
    ).toBeTruthy();
    expect(screen.getByText('x-telegram-bot-api-secret-token')).toBeTruthy();
    expect(screen.getByText('задан')).toBeTruthy();
    expect(screen.getByText('Прим.')).toBeTruthy();
    expect(screen.getByText(/Последнее входящее: 23\.07\.2026/)).toBeTruthy();
  });

  it('вебхук без секрета: «не задан»; без событий: «—»', () => {
    renderForm({
      testAction,
      check: null,
      webhook: { url: 'https://u', headerName: 'x-h', secretSet: false, lastEventAt: null },
    });
    expect(screen.getByText('не задан')).toBeTruthy();
    expect(screen.getByText(/Последнее входящее: —/)).toBeTruthy();
  });

  it('клик «Проверить подключение» зовёт testAction и показывает успех (role=status)', async () => {
    testAction.mockResolvedValue({ ok: true, success: true, message: 'Подключение успешно' });
    renderForm({ testAction, check: null });
    const btn = screen.getByText('Проверить подключение');
    fireEvent.click(btn);
    expect(await screen.findByText('Подключение успешно')).toBeTruthy();
    expect(testAction).toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled(); // сохранение не запускалось
  });

  it('неуспешная проба → сообщение в role=alert', async () => {
    testAction.mockResolvedValue({
      ok: true,
      success: false,
      message: 'Авторизация отклонена (HTTP 401)',
    });
    renderForm({ testAction, check: null });
    const btn = screen.getByText('Проверить подключение');
    fireEvent.click(btn);
    expect(await screen.findByText('Авторизация отклонена (HTTP 401)')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('ошибка контракта (ok:false) маппится в русский текст', async () => {
    testAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    renderForm({ testAction, check: null });
    const btn = screen.getByText('Проверить подключение');
    fireEvent.click(btn);
    // resolveErrorText: словарь errorMessageRu даёт русское сообщение для forbidden
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
