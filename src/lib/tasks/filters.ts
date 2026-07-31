/**
 * Этап 7 (ФТ-7.3/7.4) — состояние фильтров задач в URL-searchParams.
 * Общий модуль (не 'use client'): серверные страницы парсят query здесь,
 * клиентский тулбар только пишет query обратно.
 */

export type TasksToolbarState = {
  scope: 'mine' | 'all';
  assigneeId: string | null;
  overdue: boolean;
  view: 'board' | 'list';
};

export function parseTasksSearchParams(
  sp: Record<string, string | string[] | undefined>
): TasksToolbarState {
  const one = (k: string): string => {
    const v = sp[k];
    return typeof v === 'string' ? v : '';
  };
  return {
    scope: one('scope') === 'mine' ? 'mine' : 'all',
    assigneeId: one('assignee') || null,
    overdue: one('overdue') === '1',
    view: one('view') === 'list' ? 'list' : 'board',
  };
}
