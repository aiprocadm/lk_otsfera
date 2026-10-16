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
      tag: null,
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
      tag: null,
    });
  });

  it('этап 5 ТЗ 13.10.2026 (`Р-5-4`): тег — строчными и без пробелов по краям', () => {
    expect(parseTasksSearchParams({ tag: '  Звонок ' }).tag).toBe('звонок');
    expect(parseTasksSearchParams({ tag: ['a', 'b'] }).tag).toBeNull();
    expect(parseTasksSearchParams({ tag: '   ' }).tag).toBeNull();
  });

  it('мусор и массивы падают в дефолты (string[] от повторённых query-ключей)', () => {
    expect(
      parseTasksSearchParams({
        scope: ['mine', 'all'],
        assignee: ['a', 'b'],
        overdue: '2',
        view: ['list'],
      })
    ).toEqual({ scope: 'all', assigneeId: null, overdue: false, view: 'board', tag: null });
    expect(parseTasksSearchParams({ scope: 'everything', view: 'kanban' }).scope).toBe('all');
  });
});
