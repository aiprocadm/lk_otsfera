// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { saveNotificationPreferenceAction } = vi.hoisted(() => ({
  saveNotificationPreferenceAction: vi.fn(),
}));
vi.mock('@/server-actions/notification-preferences', () => ({ saveNotificationPreferenceAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { NotificationPreferencesMatrix } from '@/components/settings/notification-preferences-matrix';
import type { NotificationPreferenceMatrix } from '@/lib/services/notifications/eventPreferences';

/**
 * Матрица «событие × канал» (`У-229`): колонки из данных, «в кабинете» без
 * переключателя, запрещённый компанией канал — серым с подсказкой, переключение
 * шлёт СПИСОК включённых каналов строки.
 */

const matrix: NotificationPreferenceMatrix = {
  columns: ['email', 'telegram'],
  rows: [
    {
      eventType: 'document_published' as never,
      label: 'Опубликован документ',
      icon: '📄',
      group: 'orders',
      channels: [
        { key: 'email', allowedByCompany: true, enabled: true },
        { key: 'telegram', allowedByCompany: true, enabled: false },
      ],
    },
    {
      eventType: 'payment_received' as never,
      label: 'Поступила оплата',
      icon: '💰',
      group: 'orders',
      channels: [
        { key: 'email', allowedByCompany: true, enabled: true },
        { key: 'telegram', allowedByCompany: false, enabled: false },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  saveNotificationPreferenceAction.mockResolvedValue({ ok: true, channels: ['email', 'telegram'] });
});

describe('NotificationPreferencesMatrix', () => {
  it('колонки — из данных, «в кабинете» всегда включена и не переключается', () => {
    render(<NotificationPreferencesMatrix matrix={matrix} />);
    expect(screen.getByText('Почта')).toBeTruthy();
    expect(screen.getByText('Telegram')).toBeTruthy();
    const inApp = screen.getByLabelText(
      'Опубликован документ: в кабинете (всегда)'
    ) as HTMLInputElement;
    expect(inApp.checked).toBe(true);
    expect(inApp.disabled).toBe(true);
  });

  it('запрещённый компанией канал — недоступен и объясняет почему', () => {
    render(<NotificationPreferencesMatrix matrix={matrix} />);
    const cell = screen.getByLabelText('Поступила оплата: Telegram') as HTMLInputElement;
    expect(cell.disabled).toBe(true);
    expect(cell.getAttribute('title')).toBe('Отключено вашей компанией');
  });

  it('включение канала шлёт полный список включённых каналов строки', async () => {
    render(<NotificationPreferencesMatrix matrix={matrix} />);
    fireEvent.click(screen.getByLabelText('Опубликован документ: Telegram'));
    await waitFor(() => expect(saveNotificationPreferenceAction).toHaveBeenCalled());
    expect(saveNotificationPreferenceAction).toHaveBeenCalledWith('document_published', [
      'email',
      'telegram',
    ]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Канал включён');
  });

  it('выключение канала убирает его из списка', async () => {
    render(<NotificationPreferencesMatrix matrix={matrix} />);
    fireEvent.click(screen.getByLabelText('Опубликован документ: Почта'));
    await waitFor(() => expect(saveNotificationPreferenceAction).toHaveBeenCalled());
    expect(saveNotificationPreferenceAction).toHaveBeenCalledWith('document_published', []);
    expect(toastSuccess).toHaveBeenCalledWith('Канал выключен');
  });

  it('отказ сервера показывается по-русски, страница не обновляется', async () => {
    saveNotificationPreferenceAction.mockResolvedValue({
      ok: false,
      error: 'channel_disabled_by_company',
    });
    render(<NotificationPreferencesMatrix matrix={matrix} />);
    fireEvent.click(screen.getByLabelText('Опубликован документ: Telegram'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain('компани');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('нет событий — объясняет, что настраивать нечего', () => {
    render(<NotificationPreferencesMatrix matrix={{ columns: ['email'], rows: [] }} />);
    expect(screen.getByText(/не адресовано ни одно событие/)).toBeTruthy();
  });
});

describe('NotificationPreferencesMatrix — группы (`У-317`)', () => {
  const grouped: NotificationPreferenceMatrix = {
    columns: ['email'],
    rows: [
      ...matrix.rows.map((r) => ({ ...r, channels: r.channels.slice(0, 1) })),
      {
        eventType: 'task_assigned' as never,
        label: 'Назначена задача',
        icon: '✅',
        group: 'tasks',
        channels: [{ key: 'email', allowedByCompany: true, enabled: true }],
      },
    ],
  };

  it('группы в порядке реестра, у каждой — число уведомлений; пустые группы не рисуются', () => {
    const { container } = render(<NotificationPreferencesMatrix matrix={grouped} />);
    const summaries = [...container.querySelectorAll('details > summary')].map(
      (s) => s.textContent
    );
    expect(summaries).toEqual(['Задачи1 уведомление', 'Заказы2 уведомления']);
  });

  it('внутри группы — её события; группа раскрывающаяся', () => {
    const { container } = render(<NotificationPreferencesMatrix matrix={grouped} />);
    const orders = [...container.querySelectorAll('details')].find((d) =>
      d.querySelector('summary')?.textContent?.startsWith('Заказы')
    )!;
    expect(orders.textContent).toContain('Опубликован документ');
    expect(orders.textContent).toContain('Поступила оплата');
    expect(orders.textContent).not.toContain('Назначена задача');
    expect(orders.hasAttribute('open')).toBe(false);
  });
});
