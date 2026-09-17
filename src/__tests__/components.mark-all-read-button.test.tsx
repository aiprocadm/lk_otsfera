// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { markAllNotificationsReadAction } = vi.hoisted(() => ({
  markAllNotificationsReadAction: vi.fn(),
}));
vi.mock('@/server-actions/notifications', () => ({ markAllNotificationsReadAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { MarkAllReadButton } from '@/components/notifications/mark-all-read-button';

/**
 * Главное действие страницы «Уведомления» (`У-228`, `Р-Э5-3`).
 */

beforeEach(() => {
  vi.clearAllMocks();
  markAllNotificationsReadAction.mockResolvedValue({ ok: true, count: 2 });
});

describe('MarkAllReadButton', () => {
  it('когда непрочитанных нет — кнопка на месте, но неактивна и объясняет почему', () => {
    render(<MarkAllReadButton basePath="/manager/notifications" unreadTotal={0} />);
    const btn = screen.getByRole('button', { name: 'Отметить все прочитанными' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute('title')).toContain('Непрочитанных уведомлений нет');
  });

  it('нажатие зовёт действие с адресом раздела, показывает число и обновляет страницу', async () => {
    render(<MarkAllReadButton basePath="/manager/notifications" unreadTotal={2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отметить все прочитанными' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(markAllNotificationsReadAction).toHaveBeenCalledWith('/manager/notifications');
    expect(toastSuccess).toHaveBeenCalledWith('Прочитано: 2.');
  });

  it('сервер ответил нулём — человеку говорят, что помечать было нечего', async () => {
    markAllNotificationsReadAction.mockResolvedValue({ ok: true, count: 0 });
    render(<MarkAllReadButton basePath="/manager/notifications" unreadTotal={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отметить все прочитанными' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Непрочитанных не было.'));
  });

  it('отказ показывается по-русски, страница не обновляется', async () => {
    markAllNotificationsReadAction.mockResolvedValue({ ok: false, error: 'feature_disabled' });
    render(<MarkAllReadButton basePath="/manager/notifications" unreadTotal={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Отметить все прочитанными' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });
});
