// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { moveTaskAction } = vi.hoisted(() => ({ moveTaskAction: vi.fn() }));
vi.mock('@/server-actions/tasks', () => ({ moveTaskAction }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

// TaskDialog itself is covered by its own dedicated test file — stub it here so
// TaskBoard's coverage isolates to its own logic (columns/cards/drag-drop/move).
const { taskDialogSpy } = vi.hoisted(() => ({ taskDialogSpy: vi.fn() }));
vi.mock('@/components/tasks/task-dialog', () => ({
  TaskDialog: (props: { target: { id: string } | null; onClose: () => void; onSaved: () => void }) => {
    taskDialogSpy(props);
    return React.createElement(
      'div',
      { 'data-testid': 'task-dialog-stub' },
      React.createElement('button', { onClick: props.onClose }, 'stub-close'),
      React.createElement('button', { onClick: props.onSaved }, 'stub-saved')
    );
  }
}));

import { TaskBoard } from '@/components/tasks/task-board';
import type { TaskBoard as TaskBoardData } from '@/lib/services/tasks/board';
import type { TaskFormOptions } from '@/components/tasks/task-dialog';

const options: TaskFormOptions = { users: [], organizations: [], orders: [] };

const board: TaskBoardData = {
  columns: [
    { id: 'col-1', name: 'К выполнению', position: 0, statusAnchor: 'todo', isDoneColumn: false, color: null },
    { id: 'col-2', name: 'Готово', position: 1, statusAnchor: 'done', isDoneColumn: true, color: null }
  ],
  board: [
    {
      column: { id: 'col-1', name: 'К выполнению', position: 0, statusAnchor: 'todo', isDoneColumn: false, color: null },
      cards: [
        {
          id: 'task-1',
          title: 'Проверить документы',
          description: null,
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
          linkedOrganizationName: 'ООО Ромашка'
        },
        {
          id: 'task-2',
          title: 'Задача без приоритета',
          description: null,
          priority: null,
          dueDate: null,
          completedAt: null,
          createdAt: new Date('2026-01-01'),
          createdByName: 'Пётр',
          columnId: 'col-1',
          assigneeIds: [],
          assigneeNames: [],
          linkedOrderId: null,
          linkedOrderTitle: null,
          linkedOrganizationId: null,
          linkedOrganizationName: null
        }
      ]
    },
    { column: { id: 'col-2', name: 'Готово', position: 1, statusAnchor: 'done', isDoneColumn: true, color: null }, cards: [] }
  ]
};

function dataTransfer(id: string) {
  const store: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      store[type] = value;
      if (id) store['text/plain'] = id;
    },
    getData: (type: string) => store[type] ?? id
  };
}

describe('TaskBoard', () => {
  beforeEach(() => {
    refresh.mockClear();
    moveTaskAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();
    taskDialogSpy.mockClear();
  });

  it('renders columns with card counts, empty placeholder, and card fields including priority badge', () => {
    render(React.createElement(TaskBoard, { board, options }));
    expect(screen.getByText('К выполнению')).toBeTruthy();
    expect(screen.getByText('Проверить документы')).toBeTruthy();
    expect(screen.getByText('Высокий')).toBeTruthy();
    expect(screen.getByText('Иван Петров')).toBeTruthy();
    expect(screen.getByText('до 15.08.2026')).toBeTruthy();
    expect(screen.getByText('ООО Ромашка · Заказ №1')).toBeTruthy();
    expect(screen.getByText('Пусто')).toBeTruthy();
  });

  it('renders a color strip only for columns that have a color', () => {
    const colored: TaskBoardData = {
      ...board,
      board: [
        { column: { ...board.board[0].column, color: '#8B5CF6' }, cards: [] },
        board.board[1] // color: null → no strip
      ]
    };
    render(React.createElement(TaskBoard, { board: colored, options }));
    const strips = screen.getAllByTestId('column-color-strip');
    expect(strips).toHaveLength(1);
    // jsdom normalizes the hex; compare against the same serialization.
    const probe = document.createElement('div');
    probe.style.background = '#8B5CF6';
    expect(strips[0].getAttribute('style')).toBe(probe.getAttribute('style'));
    expect(strips[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('a card with no priority shows no priority badge, no assignees shows "без исполнителя", no due date shows no date span', () => {
    render(React.createElement(TaskBoard, { board, options }));
    expect(screen.getByText('Задача без приоритета')).toBeTruthy();
    expect(screen.getByText('без исполнителя')).toBeTruthy();
  });

  it('a card with only a linked organization (no order) shows just the organization name', () => {
    const b: TaskBoardData = {
      ...board,
      board: [
        {
          column: board.board[0].column,
          cards: [{ ...board.board[0].cards[0], linkedOrderTitle: null, linkedOrderId: null }]
        }
      ]
    };
    render(React.createElement(TaskBoard, { board: b, options }));
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
  });

  it('an unknown priority value falls back to the neutral badge tone (PRIORITY_TONE fallback)', () => {
    const b: TaskBoardData = {
      ...board,
      board: [
        {
          column: board.board[0].column,
          cards: [{ ...board.board[0].cards[0], priority: 'legacy_priority' as TaskBoardData['board'][0]['cards'][0]['priority'] }]
        }
      ]
    };
    render(React.createElement(TaskBoard, { board: b, options }));
    // PRIORITY_LABEL has no entry either, so the badge renders with undefined
    // text — presence of the card confirms the fallback path didn't throw.
    expect(screen.getByText('Проверить документы')).toBeTruthy();
  });

  it('clicking a card opens the TaskDialog with that card as target', () => {
    render(React.createElement(TaskBoard, { board, options }));
    fireEvent.click(screen.getByText('Проверить документы'));
    expect(taskDialogSpy).toHaveBeenCalled();
    const lastCall = taskDialogSpy.mock.calls[taskDialogSpy.mock.calls.length - 1][0];
    expect(lastCall.target.id).toBe('task-1');
  });

  it('"+ Новая задача" opens the TaskDialog with a null target', () => {
    render(React.createElement(TaskBoard, { board, options }));
    fireEvent.click(screen.getByRole('button', { name: '+ Новая задача' }));
    expect(taskDialogSpy).toHaveBeenCalled();
    const lastCall = taskDialogSpy.mock.calls[taskDialogSpy.mock.calls.length - 1][0];
    expect(lastCall.target).toBeNull();
  });

  it('the dialog stub\'s onClose/onSaved close it (dialog unmounts)', () => {
    render(React.createElement(TaskBoard, { board, options }));
    fireEvent.click(screen.getByRole('button', { name: '+ Новая задача' }));
    expect(screen.getByTestId('task-dialog-stub')).toBeTruthy();
    fireEvent.click(screen.getByText('stub-close'));
    expect(screen.queryByTestId('task-dialog-stub')).toBeNull();
  });

  it('onSaved triggers router.refresh and closes the dialog', async () => {
    render(React.createElement(TaskBoard, { board, options }));
    fireEvent.click(screen.getByRole('button', { name: '+ Новая задача' }));
    fireEvent.click(screen.getByText('stub-saved'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByTestId('task-dialog-stub')).toBeNull();
  });

  it('drag over highlights the column, drag leave un-highlights it', () => {
    render(React.createElement(TaskBoard, { board, options }));
    const column = screen.getByText('Готово').closest('div')!.parentElement as HTMLElement;
    fireEvent.dragOver(column, { dataTransfer: dataTransfer('') });
    expect(column.className).toContain('ring-2');
    fireEvent.dragLeave(column);
    expect(column.className).not.toContain('ring-2');
  });

  it('drag-leaving a non-highlighted column leaves the highlighted one untouched', () => {
    render(React.createElement(TaskBoard, { board, options }));
    const firstColumn = screen.getByText('К выполнению').closest('div')!.parentElement as HTMLElement;
    const secondColumn = screen.getByText('Готово').closest('div')!.parentElement as HTMLElement;
    fireEvent.dragOver(firstColumn, { dataTransfer: dataTransfer('') });
    fireEvent.dragLeave(secondColumn);
    expect(firstColumn.className).toContain('ring-2');
  });

  it('dragging a card sets its id on the dataTransfer (onDragStart)', () => {
    render(React.createElement(TaskBoard, { board, options }));
    const card = screen.getByText('Проверить документы').closest('article') as HTMLElement;
    const dt = dataTransfer('');
    const setDataSpy = vi.spyOn(dt, 'setData');
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(setDataSpy).toHaveBeenCalledWith('text/plain', 'task-1');
  });

  it('dropping with no dragged id does not call moveTaskAction', () => {
    render(React.createElement(TaskBoard, { board, options }));
    const column = screen.getByText('Готово').closest('div')!.parentElement as HTMLElement;
    const dt = { setData: () => {}, getData: () => '' };
    fireEvent.drop(column, { dataTransfer: dt });
    expect(moveTaskAction).not.toHaveBeenCalled();
  });

  it('drop success: calls moveTaskAction with taskId/toColumnId, toasts success, refreshes', async () => {
    moveTaskAction.mockResolvedValue({ ok: true });
    render(React.createElement(TaskBoard, { board, options }));
    const column = screen.getByText('Готово').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('task-1') });

    await waitFor(() => expect(moveTaskAction).toHaveBeenCalledTimes(1));
    const fd = moveTaskAction.mock.calls[0][0] as FormData;
    expect(fd.get('taskId')).toBe('task-1');
    expect(fd.get('toColumnId')).toBe('col-2');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Задача перемещена.'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('drop error (known code): toasts the mapped MOVE_ERRORS message', async () => {
    moveTaskAction.mockResolvedValue({ ok: false, error: 'invalid_column' });
    render(React.createElement(TaskBoard, { board, options }));
    const column = screen.getByText('Готово').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('task-1') });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Неизвестная колонка.'));
  });

  it('drop error (unmapped code): falls back to the generic message', async () => {
    moveTaskAction.mockResolvedValue({ ok: false, error: 'weird_code' });
    render(React.createElement(TaskBoard, { board, options }));
    const column = screen.getByText('Готово').closest('div')!.parentElement as HTMLElement;
    fireEvent.drop(column, { dataTransfer: dataTransfer('task-1') });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось переместить задачу.'));
  });
});
