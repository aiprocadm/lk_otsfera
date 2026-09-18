// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { action, toastError, toastSuccess, refresh } = vi.hoisted(() => ({
  action: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/server-actions/organization/memberScope', () => ({ setOrgMemberScopeAction: action }));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { OrgMemberScopeForm } from '@/components/organization/org-member-scope-form';

/** `У-236`: переключатель «сотрудники видят только свои заказы». */
beforeEach(() => {
  vi.clearAllMocks();
  action.mockResolvedValue({ ok: true });
});

describe('OrgMemberScopeForm', () => {
  it('администратор переключает: значение уходит в действие, экран перечитывается', async () => {
    render(
      React.createElement(OrgMemberScopeForm, { organizationId: 'o1', value: false, canEdit: true })
    );
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(action).toHaveBeenCalled());
    const fd = action.mock.calls[0][0] as FormData;
    expect(fd.get('organizationId')).toBe('o1');
    expect(fd.get('value')).toBe('on');
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('только свои заказы'));
    expect(refresh).toHaveBeenCalled();
  });

  it('снятие галочки шлёт пустое значение', async () => {
    render(
      React.createElement(OrgMemberScopeForm, { organizationId: 'o1', value: true, canEdit: true })
    );
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect((action.mock.calls[0][0] as FormData).get('value')).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('все заказы'));
  });

  it('отказ сервиса возвращает галочку назад и объясняет по-русски', async () => {
    action.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(
      React.createElement(OrgMemberScopeForm, { organizationId: 'o1', value: false, canEdit: true })
    );
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(box);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() =>
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    );
  });

  it('сеть отвалилась — галочка возвращается, человек видит «Сетевая ошибка»', async () => {
    // Действие может не ответить вовсе: тогда галочка не должна остаться
    // в положении, которое на сервер не доехало.
    action.mockRejectedValue(new Error('offline'));
    render(
      React.createElement(OrgMemberScopeForm, { organizationId: 'o1', value: false, canEdit: true })
    );
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
    await waitFor(() =>
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    );
  });

  it('без права правки — состояние словами, без галочки', () => {
    const { unmount } = render(
      React.createElement(OrgMemberScopeForm, { organizationId: 'o1', value: true, canEdit: false })
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByTestId('member-scope-view').textContent).toContain('только свои заказы');
    unmount();
    render(
      React.createElement(OrgMemberScopeForm, {
        organizationId: 'o1',
        value: false,
        canEdit: false,
      })
    );
    expect(screen.getByTestId('member-scope-view').textContent).toContain('все заказы организации');
  });
});
