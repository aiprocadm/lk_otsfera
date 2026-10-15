// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Страницы карточки задачи (`У-218`, этап 4 PR-1) — менеджер и руководитель.
 *
 * Один файл на два кабинета намеренно: экраны зеркальные (§0.2), и проверять
 * их по отдельности значило бы однажды поправить один и забыть второй.
 *
 * Проверяется ровно то, что делает страница: флаг, гард роли, отказ по чужой
 * задаче и передача кабинета в общий экран (от него зависят ссылки и крошки).
 *
 * Отказ по задаче — не 404, а список задач с плашкой «объект недоступен»
 * (`У-232`, спека §3.7); 404 остаётся только у выключенного флага.
 */

const { requireManager, requireManagerLeader } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager, requireManagerLeader }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOTFOUND');
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getTaskDetail } = vi.hoisted(() => ({ getTaskDetail: vi.fn() }));
vi.mock('@/lib/services/tasks/detail', () => ({ getTaskDetail }));

const { getTaskEditForm } = vi.hoisted(() => ({ getTaskEditForm: vi.fn() }));
vi.mock('@/lib/services/tasks/board', () => ({ getTaskEditForm }));
vi.mock('@/components/tasks/task-edit-button', () => ({
  TaskEditButton: (props: { listHref: string; card: { id: string } }) =>
    React.createElement('span', null, `ПРАВКА:${props.card.id}:${props.listHref}`),
}));

const { screenSpy } = vi.hoisted(() => ({ screenSpy: vi.fn() }));
vi.mock('@/components/tasks/task-page-screen', () => ({
  TaskPageScreen: (props: { task: { id: string }; cabinet: string; edit?: React.ReactNode }) => {
    screenSpy(props);
    return React.createElement(
      'div',
      null,
      `КАРТОЧКА:${props.task.id}:${props.cabinet}`,
      props.edit
    );
  },
}));

import ManagerTaskPage from '@/app/manager/tasks/[id]/page';
import LeaderTaskPage from '@/app/leader/tasks/[id]/page';

const SESSION = { sub: 'u1', role: 'manager', companyId: 'co-1' };
const TASK = { id: 't1', title: 'Проверить документы' };

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  requireManager.mockResolvedValue(SESSION);
  requireManagerLeader.mockResolvedValue({ ...SESSION, role: 'leader' });
  getTaskDetail.mockResolvedValue({ ok: true, task: TASK });
  getTaskEditForm.mockResolvedValue({
    ok: true,
    card: { id: 't1' },
    columns: [],
    options: { users: [] },
  });
});

const CASES = [
  { name: 'менеджер', Page: ManagerTaskPage, cabinet: 'manager', guard: requireManager },
  { name: 'руководитель', Page: LeaderTaskPage, cabinet: 'leader', guard: requireManagerLeader },
] as const;

describe.each(CASES)('карточка задачи: $name', ({ Page, cabinet, guard }) => {
  const open = (id: string) => Page({ params: Promise.resolve({ id }) });

  it('рисует карточку и передаёт СВОЙ кабинет — от него зависят ссылки и крошки', async () => {
    const { container } = await renderServerComponent(open('t1'));
    expect(container.textContent).toContain(`КАРТОЧКА:t1:${cabinet}`);
    expect(screenSpy.mock.calls[0][0].cabinet).toBe(cabinet);
  });

  it('этап 5 ТЗ 13.10.2026 (`У-302`): на странице есть «Редактировать», после удаления — в СВОЙ список', async () => {
    const { container } = await renderServerComponent(open('t1'));
    expect(getTaskEditForm).toHaveBeenCalledWith({}, expect.anything(), 't1');
    expect(container.textContent).toContain(`ПРАВКА:t1:/${cabinet}/tasks`);
  });

  it('данных для правки нет — кнопки нет, карточка цела', async () => {
    getTaskEditForm.mockResolvedValue({ ok: false, error: 'not_found' });
    const { container } = await renderServerComponent(open('t1'));
    expect(container.textContent).toContain(`КАРТОЧКА:t1:${cabinet}`);
    expect(container.textContent).not.toContain('ПРАВКА');
  });

  it('флаг выключен → 404, задачу даже не спрашиваем', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(open('t1'))).rejects.toThrow('NOTFOUND');
    expect(getTaskDetail).not.toHaveBeenCalled();
  });

  it('гард роли вызывается до выборки', async () => {
    await renderServerComponent(open('t1'));
    expect(guard).toHaveBeenCalled();
  });

  it('чужая или несуществующая задача → список с ?missing=1 (сервис не различает их наружу)', async () => {
    getTaskDetail.mockResolvedValue({ ok: false, error: 'not_found' });
    await expect(renderServerComponent(open('чужая'))).rejects.toThrow(
      `REDIRECT:/${cabinet}/tasks?missing=1`
    );
  });

  it('сессия без компании → тот же редирект, а не пустой экран и не 404', async () => {
    getTaskDetail.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(renderServerComponent(open('t1'))).rejects.toThrow(
      `REDIRECT:/${cabinet}/tasks?missing=1`
    );
  });
});
