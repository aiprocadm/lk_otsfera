// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { actionMock, toastErrorMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  toastErrorMock: vi.fn()
}));

vi.mock('@/server-actions/admin/users', () => ({ regenerateUserBackupCodesAction: actionMock }));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }));

import { AdminBackupCodesControl } from '@/components/admin/admin-backup-codes-control';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminBackupCodesControl', () => {
  it('renders the regenerate button, no codes initially', () => {
    render(React.createElement(AdminBackupCodesControl, { userId: 'm1' }));
    expect(screen.getByRole('button', { name: 'Перевыпустить коды восстановления' })).toBeTruthy();
    expect(screen.queryByText('AAAA')).toBeNull();
  });

  it('regenerating passes the userId and shows the new codes', async () => {
    actionMock.mockResolvedValue({ ok: true, codes: ['AAAA', 'BBBB'] });
    render(React.createElement(AdminBackupCodesControl, { userId: 'm1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить коды восстановления' }));

    await waitFor(() => expect(screen.getByText('AAAA')).toBeTruthy(), { timeout: 10000 });
    expect(screen.getByText('BBBB')).toBeTruthy();
    // FormData содержит id пользователя
    const fdArg = actionMock.mock.calls[0][0] as FormData;
    expect(fdArg.get('id')).toBe('m1');
  });

  it('re-generating from the codes-shown state shows the pending label', async () => {
    // Первый вызов сразу отдаёт коды; второй держим pending, чтобы отрендерить
    // «Генерирую…» в кнопке «Перевыпустить заново».
    let releaseSecond: (v: unknown) => void = () => {};
    actionMock
      .mockResolvedValueOnce({ ok: true, codes: ['AAAA', 'BBBB'] })
      .mockImplementationOnce(() => new Promise((r) => { releaseSecond = r; }));
    render(React.createElement(AdminBackupCodesControl, { userId: 'm1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить коды восстановления' }));
    await waitFor(() => expect(screen.getByText('AAAA')).toBeTruthy(), { timeout: 10000 });

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить заново' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Генерирую…' })).toBeTruthy(), { timeout: 10000 });

    releaseSecond({ ok: true, codes: ['CCCC', 'DDDD'] });
    await waitFor(() => expect(screen.getByText('CCCC')).toBeTruthy(), { timeout: 10000 });
  });

  it('a not_staff failure surfaces a toast error, no codes shown', async () => {
    actionMock.mockResolvedValue({ ok: false, error: 'not_staff' });
    render(React.createElement(AdminBackupCodesControl, { userId: 'p1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Перевыпустить коды восстановления' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled(), { timeout: 10000 });
    expect(screen.queryByText('AAAA')).toBeNull();
  });
});
