// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { UserDetail } from '@/lib/services/admin/users';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { updateUserAction } = vi.hoisted(() => ({ updateUserAction: vi.fn() }));
vi.mock('@/server-actions/admin/users', () => ({ updateUserAction }));

import { UserEditForm } from '@/components/admin/user-edit-form';

function user(overrides: Partial<UserDetail> = {}): UserDetail {
  return {
    id: 'u1',
    email: 'user@x.com',
    name: 'Пользователь',
    role: 'partner',
    partnerId: null,
    isActive: true,
    ...overrides
  } as UserDetail;
}

const PARTNERS = [
  { id: 'p1', name: 'Партнёр А' },
  { id: 'p2', name: 'Партнёр Б' }
];

describe('UserEditForm', () => {
  beforeEach(() => {
    updateUserAction.mockReset();
    refresh.mockClear();
  });

  it('renders email as read-only and name as controlled', () => {
    render(React.createElement(UserEditForm, { user: user(), partners: PARTNERS, isSelf: false }));
    expect(screen.getByDisplayValue('user@x.com')).toHaveProperty('readOnly', true);
    expect((screen.getByDisplayValue('Пользователь') as HTMLInputElement).value).toBe('Пользователь');
  });

  it('role=partner shows a 2-option role select (enabled) and the partner select', () => {
    render(React.createElement(UserEditForm, { user: user({ role: 'partner' }), partners: PARTNERS, isSelf: false }));
    const roleSelect = screen.getByDisplayValue('Партнёр') as HTMLSelectElement;
    expect(roleSelect.disabled).toBe(false);
    expect(Array.from(roleSelect.options).map((o) => o.textContent)).toEqual(['Партнёр', 'Студент']);
    expect(screen.getByText('— выберите —')).toBeTruthy();
  });

  it('role=student allowedRoles branch: shows Студент/Партнёр options', () => {
    render(React.createElement(UserEditForm, { user: user({ role: 'student' }), partners: PARTNERS, isSelf: false }));
    const roleSelect = screen.getByDisplayValue('Студент') as HTMLSelectElement;
    expect(Array.from(roleSelect.options).map((o) => o.textContent)).toEqual(['Студент', 'Партнёр']);
  });

  it('role=organization: single fixed option, select disabled, no partner select, shows unsupported-transition note', () => {
    render(
      React.createElement(UserEditForm, {
        user: user({ role: 'organization', partnerId: null }),
        partners: PARTNERS,
        isSelf: false
      })
    );
    const roleSelect = screen.getByDisplayValue('Организация') as HTMLSelectElement;
    expect(roleSelect.disabled).toBe(true);
    expect(screen.getByText('Переход роли для этого пользователя не поддерживается через UI.')).toBeTruthy();
    expect(screen.queryByText('— выберите —')).toBeNull();
  });

  it('role=manager: single fixed option (allowedRoles default/manager branch), select disabled', () => {
    render(React.createElement(UserEditForm, { user: user({ role: 'manager' }), partners: PARTNERS, isSelf: false }));
    const roleSelect = screen.getByDisplayValue('Менеджер') as HTMLSelectElement;
    expect(roleSelect.disabled).toBe(true);
  });

  it('role=admin (fallback branch of allowedRoles): single fixed "Админ" option', () => {
    render(React.createElement(UserEditForm, { user: user({ role: 'admin' }), partners: PARTNERS, isSelf: false }));
    const roleSelect = screen.getByDisplayValue('Админ') as HTMLSelectElement;
    expect(roleSelect.disabled).toBe(true);
  });


  it('changing role away from partner hides the partner select', () => {
    render(React.createElement(UserEditForm, { user: user({ role: 'partner' }), partners: PARTNERS, isSelf: false }));
    const roleSelect = screen.getByDisplayValue('Партнёр') as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'student' } });
    expect(screen.queryByText('— выберите —')).toBeNull();
  });

  it('selecting a partner updates the partnerId select value', () => {
    render(
      React.createElement(UserEditForm, {
        user: user({ role: 'partner', partnerId: 'p1' }),
        partners: PARTNERS,
        isSelf: false
      })
    );
    const partnerSelect = document.querySelector('select[name="partnerId"]') as HTMLSelectElement;
    expect(partnerSelect.value).toBe('p1');
    fireEvent.change(partnerSelect, { target: { value: 'p2' } });
    expect(partnerSelect.value).toBe('p2');
  });

  it('isSelf=true: role select and isActive checkbox are disabled, shows the "cannot deactivate self" note', () => {
    render(React.createElement(UserEditForm, { user: user({ role: 'partner' }), partners: PARTNERS, isSelf: true }));
    const roleSelect = screen.getByDisplayValue('Партнёр') as HTMLSelectElement;
    expect(roleSelect.disabled).toBe(true);
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Нельзя деактивировать себя.')).toBeTruthy();
  });

  it('isSelf=false: no "cannot deactivate self" note, checkbox enabled', () => {
    render(React.createElement(UserEditForm, { user: user(), partners: PARTNERS, isSelf: false }));
    expect(screen.queryByText('Нельзя деактивировать себя.')).toBeNull();
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false);
  });

  it('toggling the isActive checkbox updates the hidden isActive field', () => {
    render(React.createElement(UserEditForm, { user: user({ isActive: true }), partners: PARTNERS, isSelf: false }));
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    const hidden = document.querySelector('input[name="isActive"]') as HTMLInputElement;
    expect(hidden.value).toBe('true');
    fireEvent.click(checkbox);
    expect(hidden.value).toBe('false');
  });

  it('editing name updates the controlled input', () => {
    render(React.createElement(UserEditForm, { user: user(), partners: PARTNERS, isSelf: false }));
    const nameInput = screen.getByDisplayValue('Пользователь') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Новое имя' } });
    expect(nameInput.value).toBe('Новое имя');
  });

  it('success path: submits id and shows the success status', async () => {
    updateUserAction.mockResolvedValue({ ok: true });
    render(
      React.createElement(UserEditForm, {
        user: user({ id: 'u9', role: 'partner', partnerId: 'p1' }),
        partners: PARTNERS,
        isSelf: false
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveProperty('textContent', 'Изменения сохранены.'));
    const fd = updateUserAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('u9');
  });

  it('error path (last_admin_protected) renders the mapped alert', async () => {
    updateUserAction.mockResolvedValue({ ok: false, error: 'last_admin_protected' });
    render(
      React.createElement(UserEditForm, {
        user: user({ role: 'partner', partnerId: 'p1' }),
        partners: PARTNERS,
        isSelf: false
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty('textContent', "Нельзя деактивировать последнего активного admin'а.")
    );
  });

  it('busy state shows "Сохраняю…" and disables the submit button', async () => {
    let resolvePromise: (v: unknown) => void = () => {};
    updateUserAction.mockReturnValue(new Promise((resolve) => { resolvePromise = resolve; }));
    render(
      React.createElement(UserEditForm, {
        user: user({ role: 'partner', partnerId: 'p1' }),
        partners: PARTNERS,
        isSelf: false
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохраняю…' })).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Сохраняю…' }) as HTMLButtonElement).disabled).toBe(true);
    resolvePromise({ ok: true });
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
  });
});
