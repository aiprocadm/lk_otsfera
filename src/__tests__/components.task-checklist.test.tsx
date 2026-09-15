// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { addChecklistItemAction, toggleChecklistItemAction, deleteChecklistItemAction } = vi.hoisted(
  () => ({
    addChecklistItemAction: vi.fn(),
    toggleChecklistItemAction: vi.fn(),
    deleteChecklistItemAction: vi.fn(),
  })
);
vi.mock('@/server-actions/tasks', () => ({
  addChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
}));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { TaskChecklist } from '@/components/tasks/task-checklist';
import type { ChecklistItemView } from '@/lib/services/tasks/checklist';

/**
 * Чек-лист задачи (`У-219`). Проверяем то, что видит человек: прогресс, пустое
 * состояние с объяснением (`У-74`) и что каждое действие доносит до сервера
 * ИМЕННО тот пункт и ту задачу, о которых речь.
 */

const items: ChecklistItemView[] = [
  { id: 'i1', title: 'Позвонить', isDone: true, sortOrder: 0, doneAt: new Date('2026-09-10') },
  { id: 'i2', title: 'Отправить счёт', isDone: false, sortOrder: 1, doneAt: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  addChecklistItemAction.mockResolvedValue({ ok: true });
  toggleChecklistItemAction.mockResolvedValue({ ok: true });
  deleteChecklistItemAction.mockResolvedValue({ ok: true });
});

describe('TaskChecklist', () => {
  it('показывает прогресс «сделано из всего»', () => {
    render(React.createElement(TaskChecklist, { taskId: 't1', items }));
    expect(screen.getByText('1 из 2')).toBeTruthy();
  });

  it('пустой чек-лист объясняет, зачем он нужен, а не молчит (`У-74`)', () => {
    render(React.createElement(TaskChecklist, { taskId: 't1', items: [] }));
    expect(screen.getByText(/Чек-лист пуст/)).toBeTruthy();
    // Поле ввода — и есть главное действие пустого состояния.
    expect(screen.getByLabelText('Название пункта чек-листа')).toBeTruthy();
    expect(screen.queryByText(/из/)).toBeNull();
  });

  it('отметка пункта уходит на сервер с его id и задачей', async () => {
    render(React.createElement(TaskChecklist, { taskId: 't1', items }));
    fireEvent.click(screen.getByLabelText('Отправить счёт'));
    await waitFor(() => expect(toggleChecklistItemAction).toHaveBeenCalled());
    const fd = toggleChecklistItemAction.mock.calls[0][0] as FormData;
    expect(fd.get('itemId')).toBe('i2');
    expect(fd.get('taskId')).toBe('t1');
    expect(fd.get('isDone')).toBe('true');
    expect(refresh).toHaveBeenCalled();
  });

  it('снятие галочки передаёт isDone=false, а не отсутствие поля', async () => {
    render(React.createElement(TaskChecklist, { taskId: 't1', items }));
    fireEvent.click(screen.getByLabelText('Позвонить'));
    await waitFor(() => expect(toggleChecklistItemAction).toHaveBeenCalled());
    expect((toggleChecklistItemAction.mock.calls[0][0] as FormData).get('isDone')).toBe('false');
  });

  it('добавление пункта отправляет название и чистит поле', async () => {
    render(React.createElement(TaskChecklist, { taskId: 't1', items }));
    const input = screen.getByLabelText('Название пункта чек-листа') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Новый шаг' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(addChecklistItemAction).toHaveBeenCalled());
    const fd = addChecklistItemAction.mock.calls[0][0] as FormData;
    expect(fd.get('title')).toBe('Новый шаг');
    expect(fd.get('taskId')).toBe('t1');
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('удаление пункта уходит с его id', async () => {
    render(React.createElement(TaskChecklist, { taskId: 't1', items }));
    fireEvent.click(screen.getByLabelText('Удалить пункт «Позвонить»'));
    await waitFor(() => expect(deleteChecklistItemAction).toHaveBeenCalled());
    expect((deleteChecklistItemAction.mock.calls[0][0] as FormData).get('itemId')).toBe('i1');
  });

  it('отказ сервера показывается по-русски и список не обновляется', async () => {
    toggleChecklistItemAction.mockResolvedValue({ ok: false, error: 'not_found' });
    render(React.createElement(TaskChecklist, { taskId: 't1', items }));
    fireEvent.click(screen.getByLabelText('Отправить счёт'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });
});
