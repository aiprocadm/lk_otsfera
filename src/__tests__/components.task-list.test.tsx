// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { taskDialogSpy } = vi.hoisted(() => ({ taskDialogSpy: vi.fn() }));
vi.mock('@/components/tasks/task-dialog', () => ({
  TaskDialog: (props: {
    target: { id: string } | null;
    onClose: () => void;
    onSaved: () => void;
  }) => {
    taskDialogSpy(props);
    return React.createElement(
      'div',
      { 'data-testid': 'task-dialog-stub' },
      React.createElement('button', { onClick: props.onClose }, 'stub-close'),
      React.createElement('button', { onClick: props.onSaved }, 'stub-saved')
    );
  },
}));

import { TaskList, sortTaskRows } from '@/components/tasks/task-list';
import type { TaskBoard as TaskBoardData, TaskCard } from '@/lib/services/tasks/board';
import type { TaskFormOptions } from '@/components/tasks/task-dialog';

const options: TaskFormOptions = { users: [], organizations: [], orders: [] };

function card(over: Partial<TaskCard>): TaskCard {
  return {
    id: 'id',
    title: 'T',
    description: null,
    priority: null,
    dueDate: null,
    completedAt: null,
    createdAt: new Date('2026-01-01'),
    createdByName: 'Автор',
    columnId: 'col-1',
    assigneeIds: [],
    assigneeNames: [],
    linkedOrderId: null,
    linkedOrderTitle: null,
    linkedOrganizationId: null,
    linkedOrganizationName: null,
    linkedLeadId: null,
    linkedLeadSubject: null,
    linkedDealId: null,
    linkedDealTitle: null,
    ...over,
  };
}

const col = (id: string, name: string) => ({
  id,
  name,
  position: 0,
  statusAnchor: 'todo' as const,
  isDoneColumn: false,
  color: null,
});

function makeBoard(cards: TaskCard[]): TaskBoardData {
  return {
    columns: [col('col-1', 'К выполнению')],
    board: [{ column: col('col-1', 'К выполнению'), cards }],
  };
}

type Row = TaskCard & { columnName: string };
const row = (over: Partial<TaskCard>): Row => ({ ...card(over), columnName: 'К' });

describe('sortTaskRows (чистая сортировка ФТ-7.4)', () => {
  it('по сроку: ближайший первым, без срока — в конец; тай-брейк приоритетом', () => {
    const rows = [
      row({ id: 'later', dueDate: new Date('2026-09-01') }),
      row({ id: 'none', dueDate: null }),
      row({ id: 'soon', dueDate: new Date('2026-08-01') }),
      row({ id: 'soon-high', dueDate: new Date('2026-08-01'), priority: 'high' }),
    ];
    expect(sortTaskRows(rows, 'due').map((r) => r.id)).toEqual([
      'soon-high',
      'soon',
      'later',
      'none',
    ]);
  });

  it('по приоритету: high → medium → low → без; тай-брейк сроком', () => {
    const rows = [
      row({ id: 'no-prio' }),
      row({ id: 'low', priority: 'low' }),
      row({ id: 'high-late', priority: 'high', dueDate: new Date('2026-09-01') }),
      row({ id: 'high-soon', priority: 'high', dueDate: new Date('2026-08-01') }),
      row({ id: 'med', priority: 'medium' }),
    ];
    expect(sortTaskRows(rows, 'priority').map((r) => r.id)).toEqual([
      'high-soon',
      'high-late',
      'med',
      'low',
      'no-prio',
    ]);
  });
});

describe('TaskList', () => {
  beforeEach(() => {
    refresh.mockReset();
    taskDialogSpy.mockReset();
  });

  it('пустое состояние', () => {
    render(<TaskList board={makeBoard([])} options={options} />);
    expect(screen.getByText('Задач нет.')).toBeTruthy();
  });

  it('строка: колонка, приоритет, исполнители, связи (лид/сделка), срок', () => {
    const c = card({
      id: 't1',
      title: 'Проверить документы',
      priority: 'high',
      dueDate: new Date('2099-08-15'),
      assigneeNames: ['Иван'],
      linkedLeadSubject: 'Тема лида',
      linkedDealTitle: 'Сделка-1',
    });
    render(<TaskList board={makeBoard([c])} options={options} />);
    expect(screen.getByText('Проверить документы')).toBeTruthy();
    expect(screen.getByText('К выполнению')).toBeTruthy();
    expect(screen.getByText('Высокий')).toBeTruthy();
    expect(screen.getByText('Иван')).toBeTruthy();
    expect(screen.getByText(/Лид: Тема лида · Сделка: Сделка-1/)).toBeTruthy();
    expect(screen.queryByText(/просрочена/)).toBeNull();
  });

  it('незнакомый приоритет не роняет строку (запасной нейтральный тон)', () => {
    // Приоритеты когда-нибудь расширят. Список обязан отрисовать задачу и с
    // незнакомым значением, а не упасть на отсутствующем в справочнике тоне.
    const c = card({
      id: 't-legacy',
      title: 'Задача из будущего',
      priority: 'critical' as never,
    });
    render(<TaskList board={makeBoard([c])} options={options} />);
    expect(screen.getByText('Задача из будущего')).toBeTruthy();
  });

  it('просроченная незавершённая задача подсвечивается', () => {
    const c = card({ id: 't2', title: 'Старая', dueDate: new Date('2020-01-01') });
    render(<TaskList board={makeBoard([c])} options={options} />);
    expect(screen.getByText(/просрочена/)).toBeTruthy();
  });

  it('завершённая задача с прошедшим сроком НЕ считается просроченной', () => {
    const c = card({
      id: 't3',
      title: 'Готовая',
      dueDate: new Date('2020-01-01'),
      completedAt: new Date('2020-01-02'),
    });
    render(<TaskList board={makeBoard([c])} options={options} />);
    expect(screen.queryByText(/просрочена/)).toBeNull();
  });

  it('без приоритета/срока/исполнителей — прочерки и «без исполнителя»', () => {
    render(<TaskList board={makeBoard([card({ id: 't4', title: 'Пустая' })])} options={options} />);
    expect(screen.getByText('без исполнителя')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('клик по строке открывает диалог; onSaved закрывает и обновляет роутер', () => {
    const c = card({ id: 't5', title: 'Кликни меня' });
    render(<TaskList board={makeBoard([c])} options={options} />);
    fireEvent.click(screen.getByText('Кликни меня'));
    expect(taskDialogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ id: 't5' }) })
    );

    fireEvent.click(screen.getByText('stub-saved'));
    expect(screen.queryByTestId('task-dialog-stub')).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it('onClose просто закрывает диалог', () => {
    render(<TaskList board={makeBoard([card({ id: 't6', title: 'X' })])} options={options} />);
    fireEvent.click(screen.getByText('X'));
    fireEvent.click(screen.getByText('stub-close'));
    expect(screen.queryByTestId('task-dialog-stub')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('переключение сортировки меняет порядок строк', () => {
    const cards = [
      card({ id: 'a', title: 'А-без-срока', priority: 'high' }),
      card({ id: 'b', title: 'Б-скоро', dueDate: new Date('2099-01-01') }),
    ];
    render(<TaskList board={makeBoard(cards)} options={options} />);
    let rows = screen.getAllByRole('row').slice(1); // без thead
    expect(rows[0]!.textContent).toContain('Б-скоро');

    fireEvent.change(screen.getByLabelText('Сортировка'), { target: { value: 'priority' } });
    rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toContain('А-без-срока');
  });
});
