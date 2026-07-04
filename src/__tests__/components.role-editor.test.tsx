// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const {
  createAccessProfileAction,
  updateAccessProfileAction,
  deleteAccessProfileAction,
  assignUserProfileAction
} = vi.hoisted(() => ({
  createAccessProfileAction: vi.fn(),
  updateAccessProfileAction: vi.fn(),
  deleteAccessProfileAction: vi.fn(),
  assignUserProfileAction: vi.fn()
}));
vi.mock('@/server-actions/access/profiles', () => ({
  createAccessProfileAction,
  updateAccessProfileAction,
  deleteAccessProfileAction,
  assignUserProfileAction
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { RoleEditor } from '@/components/access/role-editor';
import type { AccessProfileListRow, AssignableUser } from '@/lib/services/access/profiles';
import type { ScopeLevel, Capability } from '@/lib/auth/accessProfile';

const profile: AccessProfileListRow = {
  id: 'p1',
  name: 'Продавец',
  orders: 'own',
  organizations: 'assigned',
  threads: 'all',
  documents: 'own',
  finance: 'own',
  leads: 'own',
  tasks: 'own',
  capabilities: ['export'],
  usersCount: 2
};

const profileNoCaps: AccessProfileListRow = {
  ...profile,
  id: 'p2',
  name: 'Без прав',
  capabilities: [],
  usersCount: 0
};

const user: AssignableUser = { id: 'u1', name: 'Иван Петров', email: 'ivan@example.com', accessProfileId: null };

function renderEditor(props: { profiles: AccessProfileListRow[]; users: AssignableUser[] }) {
  return React.createElement(RoleEditor, props);
}

describe('RoleEditor', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    createAccessProfileAction.mockReset();
    updateAccessProfileAction.mockReset();
    deleteAccessProfileAction.mockReset();
    assignUserProfileAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('renders EmptyState for both profiles and users when both are empty', () => {
    render(renderEditor({ profiles: [], users: [] }));
    expect(screen.getByText('Ролей пока нет — создайте первую, чтобы нарезать права внутри компании.')).toBeTruthy();
    expect(screen.getByText('Менеджеры компании появятся здесь после добавления.')).toBeTruthy();
  });

  it('renders a profile row with scopes, capabilities, and usersCount', () => {
    render(renderEditor({ profiles: [profile], users: [] }));
    expect(screen.getByText('Продавец')).toBeTruthy();
    expect(screen.getByText('Заявки: Свои')).toBeTruthy();
    expect(screen.getByText('Экспорт')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('falls back to the raw value for an unknown scope/capability (stale data defense)', () => {
    const stale: AccessProfileListRow = {
      ...profile,
      id: 'p-stale',
      orders: 'legacy_scope' as ScopeLevel,
      capabilities: ['legacy_cap' as Capability]
    };
    render(renderEditor({ profiles: [stale], users: [] }));
    expect(screen.getByText('Заявки: legacy_scope')).toBeTruthy();
    expect(screen.getByText('legacy_cap')).toBeTruthy();
  });

  it('renders the "—" placeholder when a profile has no capabilities', () => {
    render(renderEditor({ profiles: [profileNoCaps], users: [] }));
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders a user row and an assignment select', () => {
    render(renderEditor({ profiles: [profile], users: [user] }));
    expect(screen.getByText('Иван Петров')).toBeTruthy();
    expect(screen.getByText('ivan@example.com')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Роль сотрудника Иван Петров' })).toBeTruthy();
  });

  it('opens the create dialog from "+ Новая роль" with empty defaults', async () => {
    render(renderEditor({ profiles: [], users: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Новая роль' }));
    expect(await screen.findByText('Новая роль')).toBeTruthy();
    const nameInput = screen.getByLabelText('Название роли') as HTMLInputElement;
    expect(nameInput.value).toBe('');
  });

  it('opens the edit dialog from "Изменить" pre-filled with the target profile', async () => {
    render(renderEditor({ profiles: [profile], users: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(await screen.findByText('Изменить роль')).toBeTruthy();
    const nameInput = screen.getByLabelText('Название роли') as HTMLInputElement;
    expect(nameInput.value).toBe('Продавец');
    const exportCheckbox = screen.getByRole('checkbox', { name: 'Экспорт' }) as HTMLInputElement;
    expect(exportCheckbox.checked).toBe(true);
    const importCheckbox = screen.getByRole('checkbox', { name: 'Импорт 1С' }) as HTMLInputElement;
    expect(importCheckbox.checked).toBe(false);
  });

  it('create flow: submits form data, shows success toast, and closes (triggers refresh)', async () => {
    createAccessProfileAction.mockResolvedValue({ ok: true });
    render(renderEditor({ profiles: [], users: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Новая роль' }));
    const dialog = await screen.findByText('Новая роль');
    const dialogEl = dialog.closest('dialog') as HTMLElement;

    fireEvent.change(screen.getByLabelText('Название роли'), { target: { value: 'Новый профиль' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(createAccessProfileAction).toHaveBeenCalledTimes(1));
    const fd = createAccessProfileAction.mock.calls[0][0] as FormData;
    expect(fd.get('name')).toBe('Новый профиль');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Роль создана.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Новая роль')).toBeNull());
  });

  it('edit flow: submits with the target id set and shows the "updated" toast', async () => {
    updateAccessProfileAction.mockResolvedValue({ ok: true });
    render(renderEditor({ profiles: [profile], users: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByText('Изменить роль');
    const dialogEl = dialog.closest('dialog') as HTMLElement;

    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(updateAccessProfileAction).toHaveBeenCalledTimes(1));
    const fd = updateAccessProfileAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('p1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Роль обновлена.'));
  });

  it('create/edit error path: shows errorMessageRu-mapped toast and keeps the dialog open', async () => {
    createAccessProfileAction.mockResolvedValue({ ok: false, error: 'name_taken' });
    render(renderEditor({ profiles: [], users: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Новая роль' }));
    const dialog = await screen.findByText('Новая роль');
    const dialogEl = dialog.closest('dialog') as HTMLElement;
    fireEvent.change(screen.getByLabelText('Название роли'), { target: { value: 'Занятое имя' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Новая роль')).toBeTruthy();
  });

  it('cancel button in the dialog calls onClose without submitting', async () => {
    render(renderEditor({ profiles: [], users: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Новая роль' }));
    await screen.findByText('Новая роль');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(createAccessProfileAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Новая роль')).toBeNull());
  });

  it('delete flow: success calls deleteAccessProfileAction with id, toasts, and refreshes', async () => {
    deleteAccessProfileAction.mockResolvedValue({ ok: true });
    render(renderEditor({ profiles: [profile], users: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(deleteAccessProfileAction).toHaveBeenCalledTimes(1));
    const fd = deleteAccessProfileAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('p1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Роль удалена.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('delete flow: error path toasts the mapped message and does not refresh', async () => {
    deleteAccessProfileAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(renderEditor({ profiles: [profile], users: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('delete flow: unknown error code falls back to the generic message', async () => {
    deleteAccessProfileAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(renderEditor({ profiles: [profile], users: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось удалить роль.'));
  });

  it('assign flow: success calls assignUserProfileAction with ids, toasts, and refreshes', async () => {
    assignUserProfileAction.mockResolvedValue({ ok: true });
    render(renderEditor({ profiles: [profile], users: [user] }));
    const select = screen.getByRole('combobox', { name: 'Роль сотрудника Иван Петров' });
    fireEvent.change(select, { target: { value: 'p1' } });

    await waitFor(() => expect(assignUserProfileAction).toHaveBeenCalledTimes(1));
    const fd = assignUserProfileAction.mock.calls[0][0] as FormData;
    expect(fd.get('userId')).toBe('u1');
    expect(fd.get('profileId')).toBe('p1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Роль назначена.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('assign flow: error path toasts the mapped message and does not refresh', async () => {
    assignUserProfileAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(renderEditor({ profiles: [profile], users: [user] }));
    const select = screen.getByRole('combobox', { name: 'Роль сотрудника Иван Петров' });
    fireEvent.change(select, { target: { value: '' } });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Заказ не найден.'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('assign flow: unknown error code falls back to the generic message', async () => {
    assignUserProfileAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(renderEditor({ profiles: [profile], users: [user] }));
    const select = screen.getByRole('combobox', { name: 'Роль сотрудника Иван Петров' });
    fireEvent.change(select, { target: { value: 'p1' } });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось назначить роль.'));
  });
});
