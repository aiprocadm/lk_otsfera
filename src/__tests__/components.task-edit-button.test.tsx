// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * «Редактировать» на странице задачи (этап 5 ТЗ 13.10.2026, `У-302`): открывает
 * ту же форму, что доска; после сохранения страница обновляется, после
 * удаления — переход в список задач своего кабинета.
 */
const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));

const { dialogProps } = vi.hoisted(() => ({ dialogProps: vi.fn() }));
vi.mock('@/components/tasks/task-dialog', () => ({
  TaskDialog: (props: {
    target: { id: string };
    onClose: () => void;
    onSaved: () => void;
    onDeleted: () => void;
  }) => {
    dialogProps(props);
    return React.createElement(
      'div',
      { 'data-testid': 'dialog' },
      React.createElement('button', { onClick: props.onSaved }, 'сохранить'),
      React.createElement('button', { onClick: props.onDeleted }, 'удалить'),
      React.createElement('button', { onClick: props.onClose }, 'закрыть')
    );
  },
}));

import { TaskEditButton } from '@/components/tasks/task-edit-button';

const card = { id: 't1' } as never;

beforeEach(() => vi.clearAllMocks());

describe('TaskEditButton', () => {
  it('форма закрыта, пока не нажали «Редактировать»; открывается с этой задачей', () => {
    render(
      <TaskEditButton card={card} columns={[]} options={{} as never} listHref="/leader/tasks" />
    );
    expect(screen.queryByTestId('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    expect(screen.getByTestId('dialog')).toBeTruthy();
    expect(dialogProps.mock.calls[0][0].target).toBe(card);
  });

  it('сохранение — закрыть и обновить страницу; закрытие — просто закрыть', () => {
    render(
      <TaskEditButton card={card} columns={[]} options={{} as never} listHref="/leader/tasks" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.click(screen.getByRole('button', { name: 'сохранить' }));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.click(screen.getByRole('button', { name: 'закрыть' }));
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('удаление — переход в список задач своего кабинета', () => {
    render(
      <TaskEditButton card={card} columns={[]} options={{} as never} listHref="/leader/tasks" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));
    fireEvent.click(screen.getByRole('button', { name: 'удалить' }));
    expect(nav.push).toHaveBeenCalledWith('/leader/tasks');
  });
});
