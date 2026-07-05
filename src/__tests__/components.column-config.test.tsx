// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { createTaskColumnAction, updateTaskColumnAction, deleteTaskColumnAction } = vi.hoisted(() => ({
  createTaskColumnAction: vi.fn(),
  updateTaskColumnAction: vi.fn(),
  deleteTaskColumnAction: vi.fn()
}));
vi.mock('@/server-actions/tasks', () => ({ createTaskColumnAction, updateTaskColumnAction, deleteTaskColumnAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { ColumnConfig } from '@/components/tasks/column-config';
import type { TaskColumnView } from '@/lib/tasks/columns';

const column: TaskColumnView = {
  id: 'col-1',
  name: 'К выполнению',
  position: 0,
  statusAnchor: 'todo',
  isDoneColumn: false,
  color: null
};

const doneColumn: TaskColumnView = { ...column, id: 'col-2', name: 'Готово', statusAnchor: 'done', isDoneColumn: true };

function renderConfig(props: React.ComponentProps<typeof ColumnConfig>) {
  return React.createElement(ColumnConfig, props);
}

describe('ColumnConfig', () => {
  beforeEach(() => {
    refresh.mockClear();
    createTaskColumnAction.mockReset();
    updateTaskColumnAction.mockReset();
    deleteTaskColumnAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('shows the default-columns hint when isDefault=true, and "по умолчанию" instead of action buttons', () => {
    render(renderConfig({ columns: [column], isDefault: true }));
    expect(screen.getByText(/Сейчас используются колонки по умолчанию/)).toBeTruthy();
    expect(screen.getByText('по умолчанию')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
  });

  it('does not show the hint when isDefault=false, shows action buttons', () => {
    render(renderConfig({ columns: [column], isDefault: false }));
    expect(screen.queryByText(/Сейчас используются колонки по умолчанию/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeTruthy();
  });

  it('renders a row with position, name, anchor label, and the done-column flag', () => {
    render(renderConfig({ columns: [column, doneColumn], isDefault: false }));
    expect(screen.getByText('К выполнению', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Готово', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Да')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('unknown anchor value falls back to the raw value (anchorLabel fallback)', () => {
    const weird: TaskColumnView = { ...column, statusAnchor: 'weird_anchor' as TaskColumnView['statusAnchor'] };
    render(renderConfig({ columns: [weird], isDefault: false }));
    expect(screen.getByText('weird_anchor')).toBeTruthy();
  });

  it('opens the create dialog via "+ Колонка" with empty defaults', async () => {
    render(renderConfig({ columns: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Колонка' }));
    expect(await screen.findByText('Новая колонка')).toBeTruthy();
    const nameInput = screen.getByLabelText('Название') as HTMLInputElement;
    expect(nameInput.value).toBe('');
  });

  it('opens the edit dialog pre-filled with the target column, including the done-column checkbox', async () => {
    render(renderConfig({ columns: [doneColumn], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(await screen.findByText('Изменить колонку')).toBeTruthy();
    const nameInput = screen.getByLabelText('Название') as HTMLInputElement;
    expect(nameInput.value).toBe('Готово');
    const checkbox = screen.getByRole('checkbox', { name: /Колонка «Готово»/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('create flow: submits form data, toasts success, and closes (triggers refresh)', async () => {
    createTaskColumnAction.mockResolvedValue({ ok: true, id: 'new-id' });
    render(renderConfig({ columns: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Колонка' }));
    const dialogTitle = await screen.findByText('Новая колонка');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Ревью' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(createTaskColumnAction).toHaveBeenCalledTimes(1));
    const fd = createTaskColumnAction.mock.calls[0][0] as FormData;
    expect(fd.get('name')).toBe('Ревью');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Колонка создана.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Новая колонка')).toBeNull());
  });

  it('edit flow: submits with the target id set and toasts "updated"', async () => {
    updateTaskColumnAction.mockResolvedValue({ ok: true });
    render(renderConfig({ columns: [column], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const dialogTitle = await screen.findByText('Изменить колонку');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;

    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(updateTaskColumnAction).toHaveBeenCalledTimes(1));
    const fd = updateTaskColumnAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('col-1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Колонка обновлена.'));
  });

  it('create/edit error path: toasts the mapped message and keeps the dialog open', async () => {
    createTaskColumnAction.mockResolvedValue({ ok: false, error: 'position_taken' });
    render(renderConfig({ columns: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Колонка' }));
    const dialogTitle = await screen.findByText('Новая колонка');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Новая колонка')).toBeTruthy();
  });

  it('create/edit error with an unmapped code falls back to the generic message', async () => {
    createTaskColumnAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(renderConfig({ columns: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Колонка' }));
    const dialogTitle = await screen.findByText('Новая колонка');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось сохранить колонку.'));
  });

  it('cancel button in the dialog closes without submitting', async () => {
    render(renderConfig({ columns: [], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: '+ Колонка' }));
    await screen.findByText('Новая колонка');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(createTaskColumnAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Новая колонка')).toBeNull());
  });

  it('delete flow: success calls deleteTaskColumnAction with id, toasts, and refreshes', async () => {
    deleteTaskColumnAction.mockResolvedValue({ ok: true });
    render(renderConfig({ columns: [column], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(deleteTaskColumnAction).toHaveBeenCalledTimes(1));
    const fd = deleteTaskColumnAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('col-1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Колонка удалена.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('delete flow: error path toasts the mapped message and does not refresh', async () => {
    deleteTaskColumnAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(renderConfig({ columns: [column], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('delete flow: unknown error code falls back to the generic message', async () => {
    deleteTaskColumnAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(renderConfig({ columns: [column], isDefault: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось удалить колонку.'));
  });
});
