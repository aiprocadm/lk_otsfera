// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh, sendTestAlertAction, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  sendTestAlertAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/server-actions/admin/alerts', () => ({ sendTestAlertAction }));
vi.mock('@/lib/ui/toast', () => ({ toast }));

import {
  AlertSettingsForm,
  type AlertSettingsValues,
} from '@/components/admin/alert-settings-form';

/**
 * Форма «Оповещения» (`У-126`) — пороги мониторинга и канал доставки.
 * `У-174` добавил девятое поле: предел документов, которые 1С не приняла.
 */
const INITIAL: AlertSettingsValues = {
  queueWaitingMax: '100',
  dlqMax: '0',
  syncLagMaxHours: '24',
  renotifyCooldownHours: '6',
  oneCDeadLetterMax: '0',
  oneCPushFailedMax: '3',
  telegramChatId: '-100500',
  emailRecipients: 'ops@x.ru',
};

function mount(over: { telegramTokenSet?: boolean; action?: ReturnType<typeof vi.fn> } = {}) {
  const action = over.action ?? vi.fn().mockResolvedValue({ ok: true });
  render(
    React.createElement(AlertSettingsForm, {
      initial: INITIAL,
      telegramTokenSet: over.telegramTokenSet ?? false,
      action,
    })
  );
  return action;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AlertSettingsForm', () => {
  it('У-174: поле «Документов не выгружено в 1С — предел» есть и несёт начальное значение', () => {
    mount();
    const input = screen.getByLabelText(
      'Документов не выгружено в 1С — предел'
    ) as HTMLInputElement;
    expect(input.name).toBe('alerts_oneCPushFailedMax');
    expect(input.value).toBe('3');
    expect(input.placeholder).toBe('по умолчанию 0');
  });

  it('все шесть числовых порогов имеют имена alerts_<ключ> — их ждёт server action', () => {
    mount();
    const names = Array.from(document.querySelectorAll('input[type="text"]')).map(
      (i) => (i as HTMLInputElement).name
    );
    expect(names).toEqual([
      'alerts_queueWaitingMax',
      'alerts_dlqMax',
      'alerts_syncLagMaxHours',
      'alerts_renotifyCooldownHours',
      'alerts_oneCDeadLetterMax',
      'alerts_oneCPushFailedMax',
      'alerts_telegramChatId',
      'alerts_emailRecipients',
    ]);
  });

  it('токен: «задан» и подсказка «пусто — не менять», когда он уже сохранён', () => {
    mount({ telegramTokenSet: true });
    expect(screen.getByText('задан')).toBeTruthy();
    expect(
      (document.querySelector('input[name="alerts_telegramBotToken"]') as HTMLInputElement)
        .placeholder
    ).toContain('не менять');
  });

  it('сохранение: action получает форму, показывается «Сохранено.» и страница обновляется', async () => {
    const action = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Сохранено.'));
    const fd = action.mock.calls[0][0] as FormData;
    expect(fd.get('alerts_oneCPushFailedMax')).toBe('3');
    expect(refresh).toHaveBeenCalled();
  });

  it('ошибка границ — русская строка, а не код', async () => {
    mount({ action: vi.fn().mockResolvedValue({ ok: false, error: 'value_out_of_range' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('вне допустимых границ')
    );
  });

  it('тестовое оповещение: успех — toast с подсказкой куда смотреть', async () => {
    sendTestAlertAction.mockResolvedValue({ ok: true });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить тестовое оповещение' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.success.mock.calls[0][0]).toContain('проверьте почту и чат');
  });

  it('тестовое оповещение: сбой — toast с советом проверить токен и чат', async () => {
    sendTestAlertAction.mockResolvedValue({ ok: false, error: 'delivery_failed' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Отправить тестовое оповещение' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toContain('токен бота');
  });
});
