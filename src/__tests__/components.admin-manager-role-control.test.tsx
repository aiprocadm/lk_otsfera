// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { setManagerRoleAction } = vi.hoisted(() => ({ setManagerRoleAction: vi.fn() }));
vi.mock('@/server-actions/admin/manager', () => ({ setManagerRoleAction }));

import { ManagerRoleControl } from '@/components/admin/manager-role-control';

describe('ManagerRoleControl', () => {
  beforeEach(() => {
    setManagerRoleAction.mockReset();
    setManagerRoleAction.mockResolvedValue({ ok: true, changed: true });
  });

  it('renders "Менеджер" label and the promote button when current is null', () => {
    render(React.createElement(ManagerRoleControl, { userId: 'u1', current: null }));
    expect(screen.getByText('Менеджер')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Назначить руководителем' })).toBeTruthy();
  });

  it('renders "Руководитель" label and the demote button when current is leader', () => {
    render(React.createElement(ManagerRoleControl, { userId: 'u1', current: 'leader' }));
    expect(screen.getByText('Руководитель')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Снять руководителя' })).toBeTruthy();
  });

  it('clicking promote calls the action with role=leader and disables the button while pending', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    setManagerRoleAction.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));

    render(React.createElement(ManagerRoleControl, { userId: 'u1', current: null }));
    const button = screen.getByRole('button', { name: 'Назначить руководителем' });
    fireEvent.click(button);

    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    resolvePromise({ ok: true, changed: true });

    await waitFor(() => expect(setManagerRoleAction).toHaveBeenCalledTimes(1));
    const fd = setManagerRoleAction.mock.calls[0][0] as FormData;
    expect(fd.get('userId')).toBe('u1');
    expect(fd.get('role')).toBe('leader');
  });

  it('clicking demote calls the action with role=member', async () => {
    render(React.createElement(ManagerRoleControl, { userId: 'u2', current: 'leader' }));
    fireEvent.click(screen.getByRole('button', { name: 'Снять руководителя' }));

    await waitFor(() => expect(setManagerRoleAction).toHaveBeenCalledTimes(1));
    const fd = setManagerRoleAction.mock.calls[0][0] as FormData;
    expect(fd.get('userId')).toBe('u2');
    expect(fd.get('role')).toBe('member');
  });
});
