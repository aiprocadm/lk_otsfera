// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { setSchedulePausedAction } = vi.hoisted(() => ({ setSchedulePausedAction: vi.fn() }));
vi.mock('@/server-actions/admin/syncControl', () => ({ setSchedulePausedAction }));

import { SyncScheduleToggle } from '@/components/admin/sync-schedule-toggle';

describe('SyncScheduleToggle', () => {
  beforeEach(() => {
    setSchedulePausedAction.mockReset();
    refresh.mockClear();
  });

  it('renders active state label', () => {
    render(React.createElement(SyncScheduleToggle, { schedulerId: 's1', paused: false }));
    expect(screen.getByRole('button', { name: 'Активно — пауза' })).toBeTruthy();
  });

  it('renders paused state label', () => {
    render(React.createElement(SyncScheduleToggle, { schedulerId: 's1', paused: true }));
    expect(screen.getByRole('button', { name: 'На паузе — включить' })).toBeTruthy();
  });

  it('success path: toggling calls action with inverted paused, then router.refresh()', async () => {
    setSchedulePausedAction.mockResolvedValue({ ok: true });
    render(React.createElement(SyncScheduleToggle, { schedulerId: 's1', paused: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Активно — пауза' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const fd = setSchedulePausedAction.mock.calls[0][0] as FormData;
    expect(fd.get('schedulerId')).toBe('s1');
    expect(fd.get('paused')).toBe('true');
  });

  it('error path (queue_unavailable) shows the mapped message', async () => {
    setSchedulePausedAction.mockResolvedValue({ ok: false, error: 'queue_unavailable' });
    render(React.createElement(SyncScheduleToggle, { schedulerId: 's1', paused: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Активно — пауза' }));

    await waitFor(() => expect(screen.getByText('Очередь недоступна (Redis).')).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('error path (unknown_schedule) shows the Russian dictionary text, not the raw code', async () => {
    setSchedulePausedAction.mockResolvedValue({ ok: false, error: 'unknown_schedule' });
    render(React.createElement(SyncScheduleToggle, { schedulerId: 's1', paused: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Активно — пауза' }));

    await waitFor(() => expect(screen.getByText('Неизвестное расписание.')).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('error path (truly unknown code) falls back to the generic "Ошибка: <code>" text', async () => {
    setSchedulePausedAction.mockResolvedValue({ ok: false, error: 'weird_code' });
    render(React.createElement(SyncScheduleToggle, { schedulerId: 's1', paused: true }));
    fireEvent.click(screen.getByRole('button', { name: 'На паузе — включить' }));

    await waitFor(() => expect(screen.getByText('Ошибка: weird_code')).toBeTruthy());
  });

  it('busy state disables the button while pending', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    setSchedulePausedAction.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );
    render(React.createElement(SyncScheduleToggle, { schedulerId: 's1', paused: false }));
    const button = screen.getByRole('button', { name: 'Активно — пауза' });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('button', { name: '…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: '…' }) as HTMLButtonElement).disabled).toBe(true);
    resolvePromise({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
