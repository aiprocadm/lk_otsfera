// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { actionMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('@/server-actions/staff/backupCodes', () => ({ regenerateBackupCodesAction: actionMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }));

import { StaffBackupCodesSection } from '@/components/settings/staff-backup-codes-section';

beforeEach(() => {
  // reset, а не clear — см. комментарий-близнец в
  // components.admin-backup-codes-control.test.tsx: недоиспользованная очередь
  // `…Once` иначе протекает в следующий тест.
  vi.resetAllMocks();
});

describe('StaffBackupCodesSection', () => {
  it('renders the generate button, no codes initially', () => {
    render(React.createElement(StaffBackupCodesSection, null));
    expect(screen.getByRole('button', { name: 'Сгенерировать коды восстановления' })).toBeTruthy();
    expect(screen.queryByText('CODE0')).toBeNull();
  });

  it('generating shows the 10 codes and the one-time warning', async () => {
    actionMock.mockResolvedValue({
      ok: true,
      codes: Array.from({ length: 10 }, (_, i) => `CODE${i}`),
    });
    render(React.createElement(StaffBackupCodesSection, null));

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать коды восстановления' }));

    await waitFor(() => expect(screen.getByText('CODE0')).toBeTruthy());
    expect(screen.getByText('CODE9')).toBeTruthy();
    expect(screen.getByText(/Прежние коды восстановления аннулированы/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeTruthy();
  });

  it('re-generating from the codes-shown state shows the pending label', async () => {
    let releaseSecond: (v: unknown) => void = () => {};
    actionMock.mockResolvedValueOnce({ ok: true, codes: ['AAAA', 'BBBB'] }).mockImplementationOnce(
      () =>
        new Promise((r) => {
          releaseSecond = r;
        })
    );
    render(React.createElement(StaffBackupCodesSection, null));

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать коды восстановления' }));
    await waitFor(() => expect(screen.getByText('AAAA')).toBeTruthy());

    // См. комментарий-близнец в components.admin-backup-codes-control.test.tsx:
    // isPending спадает отдельным рендером после появления кодов, поэтому
    // кнопку с новой подписью ждём, а не берём синхронно.
    fireEvent.click(await screen.findByRole('button', { name: 'Сгенерировать заново' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Генерирую…' })).toBeTruthy());

    releaseSecond({ ok: true, codes: ['CCCC', 'DDDD'] });
    await waitFor(() => expect(screen.getByText('CCCC')).toBeTruthy());
  });

  it('forbidden result surfaces a toast error, no codes shown', async () => {
    actionMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(StaffBackupCodesSection, null));

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать коды восстановления' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(screen.queryByText('CODE0')).toBeNull();
  });

  it('copy writes the codes to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    actionMock.mockResolvedValue({ ok: true, codes: ['AAAA', 'BBBB'] });
    render(React.createElement(StaffBackupCodesSection, null));

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать коды восстановления' }));
    await waitFor(() => expect(screen.getByText('AAAA')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('AAAA\nBBBB'));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });

  it('copy failure surfaces a toast error (clipboard rejects)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });
    actionMock.mockResolvedValue({ ok: true, codes: ['AAAA', 'BBBB'] });
    render(React.createElement(StaffBackupCodesSection, null));

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать коды восстановления' }));
    await waitFor(() => expect(screen.getByText('AAAA')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать' }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Не удалось скопировать'));
  });
});
