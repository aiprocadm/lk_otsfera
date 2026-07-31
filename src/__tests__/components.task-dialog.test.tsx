// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { createTaskAction, updateTaskAction, deleteTaskAction } = vi.hoisted(() => ({
  createTaskAction: vi.fn(),
  updateTaskAction: vi.fn(),
  deleteTaskAction: vi.fn(),
}));
vi.mock('@/server-actions/tasks', () => ({ createTaskAction, updateTaskAction, deleteTaskAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { TaskDialog } from '@/components/tasks/task-dialog';
import type { TaskColumnView } from '@/lib/tasks/columns';
import type { TaskCard, TaskFormOptions } from '@/lib/services/tasks/board';

const columns: TaskColumnView[] = [
  {
    id: 'col-1',
    name: 'К выполнению',
    position: 0,
    statusAnchor: 'todo',
    isDoneColumn: false,
    color: null,
  },
  {
    id: 'col-2',
    name: 'Готово',
    position: 1,
    statusAnchor: 'done',
    isDoneColumn: true,
    color: null,
  },
];

const emptyOptions: TaskFormOptions = { users: [], organizations: [], orders: [] };

const fullOptions: TaskFormOptions = {
  users: [{ id: 'u1', name: 'Иван Петров' }],
  organizations: [{ id: 'org1', name: 'ООО Ромашка' }],
  orders: [{ id: 'ord1', title: 'Заказ №1' }],
};

const task: TaskCard = {
  id: 'task-1',
  title: 'Проверить документы',
  description: 'Срочно',
  priority: 'high',
  dueDate: new Date('2026-08-15'),
  completedAt: null,
  createdAt: new Date('2026-01-01'),
  createdByName: 'Пётр',
  columnId: 'col-1',
  assigneeIds: ['u1'],
  assigneeNames: ['Иван Петров'],
  linkedOrderId: 'ord1',
  linkedOrderTitle: 'Заказ №1',
  linkedOrganizationId: 'org1',
  linkedOrganizationName: 'ООО Ромашка',
  linkedLeadId: null,
  linkedLeadSubject: null,
  linkedDealId: null,
  linkedDealTitle: null,
};

function renderDialog(props: React.ComponentProps<typeof TaskDialog>) {
  return React.createElement(TaskDialog, props);
}

describe('TaskDialog', () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    createTaskAction.mockReset();
    updateTaskAction.mockReset();
    deleteTaskAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();
    onClose.mockClear();
    onSaved.mockClear();

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  describe('привязки к лиду/сделке (этап 7, ФТ-7.1)', () => {
    it('create без контекста: скрытые поля пустые, подписи нет', () => {
      const { container } = render(
        renderDialog({ target: null, columns, options: emptyOptions, onClose, onSaved })
      );
      const lead = container.querySelector('input[name="linkedLeadId"]') as HTMLInputElement;
      const deal = container.querySelector('input[name="linkedDealId"]') as HTMLInputElement;
      expect(lead.value).toBe('');
      expect(deal.value).toBe('');
      expect(screen.queryByText(/Привязана:/)).toBeNull();
    });

    it('link prop (создание из карточки лида): id в скрытом поле + подпись', () => {
      const { container } = render(
        renderDialog({
          target: null,
          columns,
          options: emptyOptions,
          onClose,
          onSaved,
          link: { leadId: 'l1', label: 'лид «Тема»' },
        })
      );
      const lead = container.querySelector('input[name="linkedLeadId"]') as HTMLInputElement;
      expect(lead.value).toBe('l1');
      expect(screen.getByText('Привязана: лид «Тема»')).toBeTruthy();
    });

    it('edit сохраняет связи target в скрытых полях (редактирование не стирает привязку)', () => {
      const linked = {
        ...task,
        linkedLeadId: 'l7',
        linkedLeadSubject: 'Лид-тема',
        linkedDealId: 'd7',
        linkedDealTitle: 'Сделка-7',
      };
      const { container } = render(
        renderDialog({ target: linked, columns, options: emptyOptions, onClose, onSaved })
      );
      expect(
        (container.querySelector('input[name="linkedLeadId"]') as HTMLInputElement).value
      ).toBe('l7');
      expect(
        (container.querySelector('input[name="linkedDealId"]') as HTMLInputElement).value
      ).toBe('d7');
      expect(screen.getByText('Привязана: лид «Лид-тема», сделка «Сделка-7»')).toBeTruthy();
    });
  });

  it('create mode: shows "Новая задача" title, empty defaults, no delete button', async () => {
    render(renderDialog({ target: null, columns, options: emptyOptions, onClose, onSaved }));
    expect(await screen.findByText('Новая задача')).toBeTruthy();
    const titleInput = screen.getByLabelText('Название') as HTMLInputElement;
    expect(titleInput.value).toBe('');
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });

  it('shows "Нет доступных сотрудников." when options.users is empty', () => {
    render(renderDialog({ target: null, columns, options: emptyOptions, onClose, onSaved }));
    expect(screen.getByText('Нет доступных сотрудников.')).toBeTruthy();
  });

  it('renders assignee checkboxes when options.users is non-empty', () => {
    render(renderDialog({ target: null, columns, options: fullOptions, onClose, onSaved }));
    expect(screen.getByRole('checkbox', { name: 'Иван Петров' })).toBeTruthy();
    expect(screen.queryByText('Нет доступных сотрудников.')).toBeNull();
  });

  it('edit mode: shows "Задача" title, pre-filled fields, and the delete button', async () => {
    render(renderDialog({ target: task, columns, options: fullOptions, onClose, onSaved }));
    expect(await screen.findByText('Задача')).toBeTruthy();
    const titleInput = screen.getByLabelText('Название') as HTMLInputElement;
    expect(titleInput.value).toBe('Проверить документы');
    const descInput = screen.getByLabelText('Описание') as HTMLTextAreaElement;
    expect(descInput.value).toBe('Срочно');
    const dueInput = screen.getByLabelText('Срок') as HTMLInputElement;
    expect(dueInput.value).toBe('2026-08-15');
    const assigneeCheckbox = screen.getByRole('checkbox', {
      name: 'Иван Петров',
    }) as HTMLInputElement;
    expect(assigneeCheckbox.checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeTruthy();
  });

  it("with no target and an empty columns list, the column select defaults to empty string (?? '' fallback)", () => {
    render(renderDialog({ target: null, columns: [], options: fullOptions, onClose, onSaved }));
    const select = screen.getByLabelText('Колонка') as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('a target with no dueDate renders an empty date input (dateValue null branch)', () => {
    render(
      renderDialog({
        target: { ...task, dueDate: null },
        columns,
        options: fullOptions,
        onClose,
        onSaved,
      })
    );
    const dueInput = screen.getByLabelText('Срок') as HTMLInputElement;
    expect(dueInput.value).toBe('');
  });

  it('create flow: submits form data, toasts success, and calls onSaved', async () => {
    createTaskAction.mockResolvedValue({ ok: true, id: 'new-id' });
    render(renderDialog({ target: null, columns, options: fullOptions, onClose, onSaved }));
    const dialogTitle = await screen.findByText('Новая задача');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Новая проверка' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(createTaskAction).toHaveBeenCalledTimes(1));
    const fd = createTaskAction.mock.calls[0][0] as FormData;
    expect(fd.get('title')).toBe('Новая проверка');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Задача создана.'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('edit flow: submits with the target id set and toasts "updated"', async () => {
    updateTaskAction.mockResolvedValue({ ok: true });
    render(renderDialog({ target: task, columns, options: fullOptions, onClose, onSaved }));
    const dialogTitle = await screen.findByText('Задача');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;

    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(updateTaskAction).toHaveBeenCalledTimes(1));
    const fd = updateTaskAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('task-1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Задача обновлена.'));
  });

  it('create/edit error path: toasts the mapped message, does not call onSaved', async () => {
    createTaskAction.mockResolvedValue({ ok: false, error: 'validation' });
    render(renderDialog({ target: null, columns, options: fullOptions, onClose, onSaved }));
    const dialogTitle = await screen.findByText('Новая задача');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('create/edit error with an unmapped code falls back to the generic message', async () => {
    createTaskAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(renderDialog({ target: null, columns, options: fullOptions, onClose, onSaved }));
    const dialogTitle = await screen.findByText('Новая задача');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось сохранить задачу.'));
  });

  it('cancel button calls onClose without submitting', async () => {
    render(renderDialog({ target: null, columns, options: fullOptions, onClose, onSaved }));
    await screen.findByText('Новая задача');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createTaskAction).not.toHaveBeenCalled();
  });

  it('delete flow: success calls deleteTaskAction with id, toasts, and calls onSaved', async () => {
    deleteTaskAction.mockResolvedValue({ ok: true });
    render(renderDialog({ target: task, columns, options: fullOptions, onClose, onSaved }));
    await screen.findByText('Задача');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(deleteTaskAction).toHaveBeenCalledTimes(1));
    const fd = deleteTaskAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('task-1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Задача удалена.'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('delete flow: error path toasts the mapped message and does not call onSaved', async () => {
    deleteTaskAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(renderDialog({ target: task, columns, options: fullOptions, onClose, onSaved }));
    await screen.findByText('Задача');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на загрузку.'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('delete flow: unknown error code falls back to the generic message', async () => {
    deleteTaskAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(renderDialog({ target: task, columns, options: fullOptions, onClose, onSaved }));
    await screen.findByText('Задача');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось удалить задачу.'));
  });
});
