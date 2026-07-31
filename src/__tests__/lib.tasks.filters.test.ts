import { describe, it, expect } from 'vitest';
import { parseTasksSearchParams } from '@/lib/tasks/filters';

// Этап 7 (ФТ-7.3/7.4) — парсер searchParams фильтров задач.
describe('parseTasksSearchParams', () => {
  it('дефолты: все задачи, доска, без фильтров', () => {
    expect(parseTasksSearchParams({})).toEqual({
      scope: 'all',
      assigneeId: null,
      overdue: false,
      view: 'board',
    });
  });

  it('валидные значения парсятся', () => {
    expect(
      parseTasksSearchParams({ scope: 'mine', assignee: 'u2', overdue: '1', view: 'list' })
    ).toEqual({
      scope: 'mine',
      assigneeId: 'u2',
      overdue: true,
      view: 'list',
    });
  });

  it('мусор и массивы падают в дефолты (string[] от повторённых query-ключей)', () => {
    expect(
      parseTasksSearchParams({
        scope: ['mine', 'all'],
        assignee: ['a', 'b'],
        overdue: '2',
        view: ['list'],
      })
    ).toEqual({ scope: 'all', assigneeId: null, overdue: false, view: 'board' });
    expect(parseTasksSearchParams({ scope: 'everything', view: 'kanban' }).scope).toBe('all');
  });
});
