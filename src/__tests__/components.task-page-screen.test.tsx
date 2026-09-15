// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server-actions/tasks', () => ({
  addTaskCommentAction: vi.fn(),
  addChecklistItemAction: vi.fn(),
  toggleChecklistItemAction: vi.fn(),
  deleteChecklistItemAction: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TaskPageScreen } from '@/components/tasks/task-page-screen';
import type { TaskDetail } from '@/lib/services/tasks/detail';

/**
 * Экран карточки задачи (`У-218`) — один на два кабинета сотрудников.
 *
 * Здесь проверяется и правило зеркала (§0.2): экран обязан вести ссылки в ТОТ
 * кабинет, в котором открыт. Ссылка из кабинета руководителя на `/manager/...`
 * не сломает страницу — она молча уведёт человека в чужой кабинет, и заметить
 * это без теста почти невозможно.
 */

function detail(over: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 't1',
    title: 'Проверить документы',
    description: 'Подробности',
    status: 'in_progress',
    priority: 'high',
    dueDate: new Date('2026-09-20'),
    completedAt: null,
    createdAt: new Date('2026-09-01'),
    createdById: 'u1',
    createdByName: 'Пётр',
    createdByRuleId: null,
    columnId: 'default:in_progress',
    columnName: 'В работе',
    assignees: [{ id: 'u1', name: 'Иван' }],
    links: [{ kind: 'order', id: 'ord1', title: 'Заказ №1' }],
    checklist: [],
    comments: [],
    history: [],
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('TaskPageScreen', () => {
  it('отвечает на три вопроса §15: где я, что здесь, что дальше', () => {
    render(React.createElement(TaskPageScreen, { task: detail(), cabinet: 'manager' }));
    // «Где я» — заголовок задачи И хлебные крошки: название встречается дважды,
    // и это правильно (крошка «Задачи → Проверить документы»).
    expect(screen.getByRole('heading', { name: 'Проверить документы' })).toBeTruthy();
    expect(screen.getAllByText('Проверить документы').length).toBeGreaterThan(1);
    // «Что здесь» — подзаголовок одной строкой, без внутренних терминов.
    expect(screen.getByText(/Что нужно сделать, кто делает и к какому сроку/)).toBeTruthy();
    // «Что дальше» — видимые действия: добавить шаг и написать комментарий.
    expect(screen.getByLabelText('Название пункта чек-листа')).toBeTruthy();
    expect(screen.getByLabelText('Текст комментария')).toBeTruthy();
  });

  it('ссылки связей ведут в СВОЙ кабинет (правило зеркала)', () => {
    const { unmount } = render(
      React.createElement(TaskPageScreen, { task: detail(), cabinet: 'manager' })
    );
    expect(screen.getByRole('link', { name: 'Заказ №1' }).getAttribute('href')).toBe(
      '/manager/orders/ord1'
    );
    unmount();
    render(React.createElement(TaskPageScreen, { task: detail(), cabinet: 'leader' }));
    expect(screen.getByRole('link', { name: 'Заказ №1' }).getAttribute('href')).toBe(
      '/leader/orders/ord1'
    );
  });

  it('каждый вид связи ведёт по своему адресу', () => {
    render(
      React.createElement(TaskPageScreen, {
        task: detail({
          links: [
            { kind: 'organization', id: 'org1', title: 'ООО Ромашка' },
            { kind: 'lead', id: 'l1', title: 'Заявка' },
            { kind: 'deal', id: 'd1', title: 'Сделка' },
          ],
        }),
        cabinet: 'manager',
      })
    );
    expect(screen.getByRole('link', { name: 'ООО Ромашка' }).getAttribute('href')).toBe(
      '/manager/organizations/org1'
    );
    expect(screen.getByRole('link', { name: 'Заявка' }).getAttribute('href')).toBe(
      '/manager/leads/l1'
    );
    expect(screen.getByRole('link', { name: 'Сделка' }).getAttribute('href')).toBe(
      '/manager/deals?dealId=d1'
    );
  });

  it('просроченная задача помечена, выполненная — тоже, и это разные пометки', () => {
    const { unmount } = render(
      React.createElement(TaskPageScreen, {
        task: detail({ dueDate: new Date('2020-01-01') }),
        cabinet: 'manager',
      })
    );
    expect(screen.getByText('Просрочена')).toBeTruthy();
    unmount();
    render(
      React.createElement(TaskPageScreen, {
        task: detail({ dueDate: new Date('2020-01-01'), completedAt: new Date('2020-02-01') }),
        cabinet: 'manager',
      })
    );
    // Выполненная задача со старым сроком просроченной УЖЕ не является.
    expect(screen.getByText('Выполнена')).toBeTruthy();
    expect(screen.queryByText('Просрочена')).toBeNull();
  });

  it('задача без описания, связей и истории объясняет пустоту, а не молчит', () => {
    render(
      React.createElement(TaskPageScreen, {
        task: detail({ description: null, links: [] }),
        cabinet: 'manager',
      })
    );
    expect(screen.getByText(/Описания нет/)).toBeTruthy();
    expect(screen.getByText(/ни к чему не привязана/)).toBeTruthy();
    expect(screen.getByText('Записей пока нет.')).toBeTruthy();
  });

  it('задача без исполнителей и без срока говорит об этом прямо', () => {
    render(
      React.createElement(TaskPageScreen, {
        task: detail({ assignees: [], dueDate: null, priority: null }),
        cabinet: 'manager',
      })
    );
    expect(screen.getByText('никто не назначен')).toBeTruthy();
    expect(screen.getByText('не задан')).toBeTruthy();
    expect(screen.getByText('обычный')).toBeTruthy();
  });

  it('`У-223`: задача робота честно говорит, что её создало правило', () => {
    const { unmount } = render(
      React.createElement(TaskPageScreen, { task: detail(), cabinet: 'manager' })
    );
    expect(screen.queryByText(/создана правилом/i)).toBeNull();
    unmount();
    render(
      React.createElement(TaskPageScreen, {
        task: detail({ createdByRuleId: 'rule-1' }),
        cabinet: 'manager',
      })
    );
    expect(screen.getByText(/создана правилом автоматизации/i)).toBeTruthy();
  });

  it('история показывает действие, время и автора; действие системы — без автора', () => {
    render(
      React.createElement(TaskPageScreen, {
        task: detail({
          history: [
            { id: 'a1', at: new Date('2026-09-02'), action: 'Перенос задачи', actorName: 'Пётр' },
            { id: 'a2', at: new Date('2026-09-01'), action: 'Создание задачи', actorName: null },
          ],
        }),
        cabinet: 'manager',
      })
    );
    expect(screen.getByText('Перенос задачи')).toBeTruthy();
    expect(screen.getByText(/· Пётр/)).toBeTruthy();
    expect(screen.getByText('Создание задачи')).toBeTruthy();
  });
});
