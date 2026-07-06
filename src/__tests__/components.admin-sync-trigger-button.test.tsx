// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { triggerSyncAction } = vi.hoisted(() => ({ triggerSyncAction: vi.fn() }));
vi.mock('@/server-actions/admin/syncControl', () => ({ triggerSyncAction }));

import { SyncTriggerButton } from '@/components/admin/sync-trigger-button';

describe('SyncTriggerButton', () => {
  beforeEach(() => {
    triggerSyncAction.mockReset();
    refresh.mockClear();
  });

  it('renders the trigger label', () => {
    render(React.createElement(SyncTriggerButton, { entity: 'orders' }));
    expect(screen.getByRole('button', { name: 'Запустить' })).toBeTruthy();
  });

  it('success path: calls action with entity, then router.refresh()', async () => {
    triggerSyncAction.mockResolvedValue({ ok: true });
    render(React.createElement(SyncTriggerButton, { entity: 'orders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const fd = triggerSyncAction.mock.calls[0][0] as FormData;
    expect(fd.get('entity')).toBe('orders');
  });

  it('error path (already_running) shows the mapped message and does not refresh', async () => {
    triggerSyncAction.mockResolvedValue({ ok: false, error: 'already_running' });
    render(React.createElement(SyncTriggerButton, { entity: 'orders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(screen.getByText('Синк уже выполняется.')).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('error path (unknown code) falls back to the generic text', async () => {
    triggerSyncAction.mockResolvedValue({ ok: false, error: 'mystery' });
    render(React.createElement(SyncTriggerButton, { entity: 'payments' }));
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }));

    await waitFor(() => expect(screen.getByText('Ошибка: mystery')).toBeTruthy());
  });

  it('busy state shows "Запуск…" and disables the button', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    triggerSyncAction.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    render(React.createElement(SyncTriggerButton, { entity: 'orders' }));
    const button = screen.getByRole('button', { name: 'Запустить' });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Запуск…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Запуск…' }) as HTMLButtonElement).disabled).toBe(true);
    resolvePromise({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
