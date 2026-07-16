// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { requeuePendingRecordAction } = vi.hoisted(() => ({ requeuePendingRecordAction: vi.fn() }));
vi.mock('@/server-actions/admin/pendingRecords', () => ({ requeuePendingRecordAction }));

const { success, error } = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success, error } }));

import { RequeuePendingButton } from '@/components/admin/requeue-pending-button';

describe('RequeuePendingButton', () => {
  beforeEach(() => {
    requeuePendingRecordAction.mockReset();
    success.mockClear();
    error.mockClear();
  });

  it('renders the requeue label', () => {
    render(<RequeuePendingButton id="rec-1" />);
    expect(screen.getByRole('button', { name: 'Вернуть в очередь' })).toBeTruthy();
  });

  it('success path: calls the action with the record id and toasts success', async () => {
    requeuePendingRecordAction.mockResolvedValue({ ok: true });
    render(<RequeuePendingButton id="rec-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в очередь' }));

    await waitFor(() => expect(success).toHaveBeenCalledWith('Запись возвращена в очередь'));
    const fd = requeuePendingRecordAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('rec-1');
    expect(error).not.toHaveBeenCalled();
  });

  it('not_dead → контекстная дельта «Запись уже не в статусе dead»', async () => {
    requeuePendingRecordAction.mockResolvedValue({ ok: false, error: 'not_dead' });
    render(<RequeuePendingButton id="rec-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в очередь' }));

    await waitFor(() => expect(error).toHaveBeenCalledWith('Запись уже не в статусе dead'));
    expect(success).not.toHaveBeenCalled();
  });

  it('not_found → дельта «Запись не найдена.» (центральный код говорит про заказ)', async () => {
    requeuePendingRecordAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(<RequeuePendingButton id="rec-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в очередь' }));

    await waitFor(() => expect(error).toHaveBeenCalledWith('Запись не найдена.'));
  });

  it('forbidden → дельта «Нет прав на это действие.» (центральный код говорит про загрузку)', async () => {
    requeuePendingRecordAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(<RequeuePendingButton id="rec-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в очередь' }));

    await waitFor(() => expect(error).toHaveBeenCalledWith('Нет прав на это действие.'));
  });

  it('unknown code falls back to the generic resolveErrorText text', async () => {
    requeuePendingRecordAction.mockResolvedValue({ ok: false, error: 'mystery' });
    render(<RequeuePendingButton id="rec-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в очередь' }));

    await waitFor(() => expect(error).toHaveBeenCalledWith('Ошибка: mystery'));
  });

  // pending-disabled поведение живёт в ActionToastButton —
  // см. components.ui-action-toast-button.test.tsx
});
