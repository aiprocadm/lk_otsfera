// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/manager/tasks',
  useSearchParams: () => new URLSearchParams('')
}));

import { TasksToolbar } from '@/components/tasks/tasks-toolbar';
import type { TasksToolbarState } from '@/lib/tasks/filters';

const DEFAULT: TasksToolbarState = { scope: 'all', assigneeId: null, overdue: false, view: 'board' };

describe('TasksToolbar (этап 7, ФТ-7.3/7.4)', () => {
  beforeEach(() => replace.mockReset());

  it('рендерит сегменты охвата/вида и чекбокс просроченных', () => {
    render(<TasksToolbar state={DEFAULT} assigneeOptions={null} />);
    expect(screen.getByRole('button', { name: 'Все' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Мои' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Доска' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Список' })).toBeTruthy();
    expect(screen.getByLabelText('Просроченные')).toBeTruthy();
    // Фильтр по исполнителю скрыт (менеджер).
    expect(screen.queryByLabelText('Исполнитель')).toBeNull();
  });

  it('«Мои» пишет scope=mine в query', () => {
    render(<TasksToolbar state={DEFAULT} assigneeOptions={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Мои' }));
    expect(replace).toHaveBeenCalledWith('/manager/tasks?scope=mine');
  });

  it('«Все» из режима mine чистит query до голого пути', () => {
    render(<TasksToolbar state={{ ...DEFAULT, scope: 'mine' }} assigneeOptions={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Все' }));
    expect(replace).toHaveBeenCalledWith('/manager/tasks');
  });

  it('чекбокс просроченных ставит overdue=1 и снимает его', () => {
    const { rerender } = render(<TasksToolbar state={DEFAULT} assigneeOptions={null} />);
    fireEvent.click(screen.getByLabelText('Просроченные'));
    expect(replace).toHaveBeenCalledWith('/manager/tasks?overdue=1');

    replace.mockReset();
    rerender(<TasksToolbar state={{ ...DEFAULT, overdue: true }} assigneeOptions={null} />);
    fireEvent.click(screen.getByLabelText('Просроченные'));
    expect(replace).toHaveBeenCalledWith('/manager/tasks');
  });

  it('фильтр по исполнителю (лидер): выбор пишет assignee, сброс удаляет', () => {
    const users = [{ id: 'm2', name: 'Мария' }];
    const { rerender } = render(<TasksToolbar state={DEFAULT} assigneeOptions={users} />);
    fireEvent.change(screen.getByLabelText('Исполнитель'), { target: { value: 'm2' } });
    expect(replace).toHaveBeenCalledWith('/manager/tasks?assignee=m2');

    replace.mockReset();
    rerender(<TasksToolbar state={{ ...DEFAULT, assigneeId: 'm2' }} assigneeOptions={users} />);
    fireEvent.change(screen.getByLabelText('Исполнитель'), { target: { value: '' } });
    expect(replace).toHaveBeenCalledWith('/manager/tasks');
  });

  it('переключение вида: список → view=list, доска → без параметра', () => {
    const { rerender } = render(<TasksToolbar state={DEFAULT} assigneeOptions={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Список' }));
    expect(replace).toHaveBeenCalledWith('/manager/tasks?view=list');

    replace.mockReset();
    rerender(<TasksToolbar state={{ ...DEFAULT, view: 'list' }} assigneeOptions={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Доска' }));
    expect(replace).toHaveBeenCalledWith('/manager/tasks');
  });

  it('несколько активных фильтров комбинируются в query', () => {
    render(
      <TasksToolbar state={{ scope: 'mine', assigneeId: 'm2', overdue: true, view: 'board' }} assigneeOptions={[{ id: 'm2', name: 'М' }]} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Список' }));
    const url = replace.mock.calls[0]![0] as string;
    expect(url).toContain('scope=mine');
    expect(url).toContain('assignee=m2');
    expect(url).toContain('overdue=1');
    expect(url).toContain('view=list');
  });
});
